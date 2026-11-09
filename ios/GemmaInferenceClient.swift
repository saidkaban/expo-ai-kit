import Foundation
import CryptoKit

/// One non-system message passed to LiteRT-LM with its real role.
struct ChatTurn: Sendable {
  let isAssistant: Bool
  var text: String

  /// Chat templates can require alternating roles, so consecutive messages from
  /// one side become a single turn.
  static func from(_ messages: [[String: Any]]) -> [ChatTurn] {
    var turns: [ChatTurn] = []
    for message in messages {
      let isAssistant = (message["role"] as? String) == "assistant"
      let text = message["content"] as? String ?? ""
      if let last = turns.last, last.isAssistant == isAssistant {
        turns[turns.count - 1].text += "\n" + text
      } else {
        turns.append(ChatTurn(isAssistant: isAssistant, text: text))
      }
    }
    return turns
  }
}

/// Compiled only when the `llm` option is on: ExpoAiKit.podspec excludes this
/// file (and the LiteRT-LM wrapper sources it depends on) otherwise.
actor GemmaInferenceClient {

  private var engine: Engine?
  private var conversation: Conversation?
  private var loadedModelId: String?

  // Sampling config for the session, fixed at load. Kept so each inference call
  // can build a FRESH conversation: the JS layer passes the full history every
  // call (stateless-model contract), so reusing one native conversation would
  // feed the model its own history twice, and a second turn on the same
  // conversation trips LiteRT-LM's chat-template engine on some models
  // (qwen3: "string has no method named strip").
  private var conversationConfig: ConversationConfig?

  // Native stop for the in-flight stream (see cancelStream). Streams run one at
  // a time behind the JS single-flight guard.
  private var activeStreamSessionId: String?
  private var streamConversation: Conversation?
  private var streamCancelRequested = false
  // Stops that reached the actor before their stream did.
  private var pendingStreamCancels: Set<String> = []

  private var isDownloading = false
  private var currentDownloader: ModelDownloader?

  // MARK: - Paths

  private static var cacheDirectory: URL {
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let dir = caches.appendingPathComponent("ExpoAiKit/litertlm", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  nonisolated func modelFileURL(_ modelId: String) -> URL {
    return LlmModelFiles.modelFileURL(modelId)
  }

  nonisolated func isModelFileDownloaded(_ modelId: String) -> Bool {
    return FileManager.default.fileExists(atPath: modelFileURL(modelId).path)
  }

  func getLoadedModelId() -> String? { loadedModelId }
  func isModelLoaded() -> Bool { engine != nil }

  // MARK: - Model lifecycle

  /// Load a model into memory. Unloads any previously loaded model first.
  ///
  /// Sampling knobs (temperature/topK/topP/seed) are fixed at conversation
  /// creation by LiteRT-LM, so they're applied here rather than per-call. If any
  /// is provided, a full SamplerConfig is built (LiteRT-LM requires all three of
  /// topK/topP/temperature), filling unspecified values with Gemma-typical
  /// defaults; if none is provided, the engine/model defaults are used.
  func loadModel(
    modelId: String,
    backend: String,
    temperature: Float? = nil,
    topK: Int? = nil,
    topP: Float? = nil,
    seed: Int? = nil
  ) async throws {
    // Unload previous model if different
    if let current = loadedModelId, current != modelId {
      conversation = nil
      engine = nil
      loadedModelId = nil
    }
    if loadedModelId == modelId, engine != nil {
      return // Already loaded
    }

    let modelPath = modelFileURL(modelId).path
    guard FileManager.default.fileExists(atPath: modelPath) else {
      throw GemmaError.modelNotDownloaded(modelId)
    }

    let cacheDir = Self.cacheDirectory.path

    do {
      let newEngine = try await initializeEngine(
        modelPath: modelPath, cacheDir: cacheDir, backend: backend
      )
      let samplerConfig: SamplerConfig?
      if temperature != nil || topK != nil || topP != nil || seed != nil {
        samplerConfig = try SamplerConfig(
          topK: topK ?? 64,
          topP: topP ?? 0.95,
          temperature: temperature ?? 1.0,
          seed: seed ?? 0
        )
      } else {
        samplerConfig = nil
      }
      let config = ConversationConfig(samplerConfig: samplerConfig)
      let newConversation = try await newEngine.createConversation(with: config)
      engine = newEngine
      conversation = newConversation
      conversationConfig = config
      loadedModelId = modelId
    } catch {
      conversation = nil
      engine = nil
      conversationConfig = nil
      loadedModelId = nil
      throw GemmaError.modelLoadFailed(modelId, reason: "\(error)")
    }
  }

  /// Replace the current conversation with a fresh one for a single call, see
  /// `conversationConfig` for why inference never reuses one across calls.
  /// (Reassigning releases the previous conversation's native handle.)
  ///
  /// The system prompt and earlier turns go in as real roles, and the returned
  /// text is the last turn, to send on the new conversation.
  private func freshConversation(
    turns: [ChatTurn],
    systemPrompt: String
  ) async throws -> (conversation: Conversation, prompt: String) {
    guard let eng = engine else {
      throw GemmaError.modelNotDownloaded(loadedModelId ?? "unknown")
    }
    conversation = nil
    let system = systemPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
    let config = ConversationConfig(
      systemMessage: system.isEmpty ? nil : Message(system, role: .system),
      initialMessages: turns.dropLast().map { Message($0.text, role: $0.isAssistant ? .model : .user) },
      samplerConfig: conversationConfig?.samplerConfig
    )
    do {
      let conv = try await eng.createConversation(with: config)
      conversation = conv
      return (conv, turns.last?.text ?? "")
    } catch {
      throw GemmaError.inferenceFailed(
        loadedModelId ?? "unknown", reason: "Failed to create conversation: \(error)"
      )
    }
  }

  /// "auto" tries GPU first, then falls back to CPU. "gpu"/"cpu" force the backend.
  private func initializeEngine(modelPath: String, cacheDir: String, backend: String) async throws -> Engine {
    func makeEngine(_ b: Backend) async throws -> Engine {
      let config = try EngineConfig(modelPath: modelPath, backend: b, cacheDir: cacheDir)
      let engine = Engine(engineConfig: config)
      try await engine.initialize()
      return engine
    }

    switch backend {
    case "gpu":
      return try await makeEngine(.gpu)
    case "cpu":
      return try await makeEngine(.cpu())
    default:
      do { return try await makeEngine(.gpu) }
      catch { return try await makeEngine(.cpu()) }
    }
  }

  func unloadModel() async {
    conversation = nil
    engine = nil
    loadedModelId = nil
  }

  // MARK: - Inference

  /// Generate a complete response. Blocks until done.
  func generateText(turns: [ChatTurn], systemPrompt: String) async throws -> String {
    let (conv, prompt) = try await freshConversation(turns: turns, systemPrompt: systemPrompt)
    do {
      let response = try await conv.sendMessage(Message(prompt))
      return response.toString
    } catch {
      throw GemmaError.inferenceFailed(loadedModelId ?? "unknown", reason: "\(error)")
    }
  }

  /// Generate a streaming response. The onChunk closure receives
  /// (token=delta, accumulatedText=full, isDone) matching the contract used by
  /// startStreaming in ExpoAiKitModule.swift.
  ///
  /// LiteRT-LM may deliver each Message chunk as either an accumulated string
  /// or a delta, mirror Android's detection logic to handle both safely.
  func generateTextStream(
    sessionId: String,
    turns: [ChatTurn],
    systemPrompt: String,
    onChunk: @Sendable (_ token: String, _ accumulatedText: String, _ isDone: Bool) -> Void
  ) async throws {
    // Any other pending id is stale: its stream already ended.
    streamCancelRequested = pendingStreamCancels.contains(sessionId)
    pendingStreamCancels.removeAll()
    activeStreamSessionId = sessionId
    defer {
      activeStreamSessionId = nil
      streamConversation = nil
      streamCancelRequested = false
    }
    if streamCancelRequested {
      onChunk("", "", true)
      return
    }

    let (conv, prompt) = try await freshConversation(turns: turns, systemPrompt: systemPrompt)

    var accumulated = ""
    var previousText = ""

    do {
      let stream = conv.sendMessageStream(Message(prompt))
      streamConversation = conv
      // A stop that arrived while the conversation was being created.
      if streamCancelRequested { try? conv.cancel() }
      for try await chunk in stream {
        if Task.isCancelled {
          try? conv.cancel()
          break
        }
        // Stopped: keep draining until LiteRT-LM ends the stream, emit nothing.
        if streamCancelRequested { continue }

        let chunkText = chunk.toString
        let token: String
        if chunkText.hasPrefix(previousText) && chunkText.count >= previousText.count {
          // Accumulated text, extract delta
          token = String(chunkText.dropFirst(previousText.count))
          previousText = chunkText
          accumulated = chunkText
        } else {
          // Delta token, accumulate ourselves
          token = chunkText
          accumulated += chunkText
          previousText = accumulated
        }
        onChunk(token, accumulated, false)
      }
      // Task cancellation ends the iteration without waiting for a chunk; still
      // ask LiteRT-LM to stop.
      if Task.isCancelled { try? conv.cancel() }
      // Always emit a terminal chunk, including on cooperative cancellation,
      // so the JS stream settles instead of hanging.
      onChunk("", accumulated, true)
    } catch is CancellationError {
      try? conv.cancel()
      onChunk("", accumulated, true)
    } catch {
      // cancel() ends the native stream with an error once decoding has
      // stopped: that is the stop that was asked for, not a failure.
      if streamCancelRequested {
        onChunk("", accumulated, true)
        return
      }
      throw GemmaError.inferenceFailed(loadedModelId ?? "unknown", reason: "\(error)")
    }
  }

  /// Stop the stream for `sessionId` natively. Unlike cancelling the Swift task,
  /// which ends iteration immediately, this keeps generateTextStream draining
  /// until LiteRT-LM reports the stream ended, so the terminal event (which
  /// releases the JS single-flight guard) is not sent while the model is still
  /// decoding. A stop that arrives before its stream starts is remembered.
  func cancelStream(sessionId: String) {
    guard activeStreamSessionId == sessionId else {
      pendingStreamCancels.insert(sessionId)
      return
    }
    streamCancelRequested = true
    try? streamConversation?.cancel()
  }

  // MARK: - Download

  /// Download a model file with progress reporting. Atomic via .tmp → rename.
  func downloadModelFile(
    modelId: String,
    urlString: String,
    sha256: String,
    onProgress: @Sendable @escaping (_ bytesRead: Int64, _ totalBytes: Int64) -> Void
  ) async throws {
    if isDownloading {
      throw GemmaError.downloadFailed(modelId, reason: "Download already in progress")
    }
    isDownloading = true
    defer {
      isDownloading = false
      currentDownloader = nil
    }

    guard let url = URL(string: urlString) else {
      throw GemmaError.downloadFailed(modelId, reason: "Invalid URL")
    }

    let targetURL = modelFileURL(modelId)
    let tempURL = targetURL.appendingPathExtension("tmp")

    // Clean any prior partial
    try? FileManager.default.removeItem(at: tempURL)

    do {
      let downloader = ModelDownloader(progressHandler: onProgress)
      currentDownloader = downloader
      let downloadedURL = try await downloader.download(from: url)

      // Move downloaded file to .tmp location
      try? FileManager.default.removeItem(at: tempURL)
      try FileManager.default.moveItem(at: downloadedURL, to: tempURL)

      // SHA256 verify
      if !sha256.isEmpty {
        let actual = try sha256OfFile(at: tempURL)
        if actual.lowercased() != sha256.lowercased() {
          try? FileManager.default.removeItem(at: tempURL)
          throw GemmaError.downloadCorrupt(modelId, expected: sha256, actual: actual)
        }
      }

      // Atomic rename
      try? FileManager.default.removeItem(at: targetURL)
      try FileManager.default.moveItem(at: tempURL, to: targetURL)
    } catch let error as GemmaError {
      try? FileManager.default.removeItem(at: tempURL)
      throw error
    } catch let urlError as URLError where urlError.code == .cancelled {
      try? FileManager.default.removeItem(at: tempURL)
      throw GemmaError.downloadCancelled(modelId)
    } catch {
      try? FileManager.default.removeItem(at: tempURL)
      throw GemmaError.downloadFailed(modelId, reason: "\(error)")
    }
  }

  /// Cancel the in-flight download, if any. The pending downloadModelFile call
  /// throws GemmaError.downloadCancelled.
  func cancelDownload(_ modelId: String) {
    currentDownloader?.cancel()
  }

  /// Delete a model file. If the model is currently loaded, unloads it first.
  func deleteModelFile(modelId: String) async {
    if loadedModelId == modelId {
      conversation = nil
      engine = nil
      loadedModelId = nil
    }
    let target = modelFileURL(modelId)
    let temp = target.appendingPathExtension("tmp")
    try? FileManager.default.removeItem(at: target)
    try? FileManager.default.removeItem(at: temp)
  }

  // MARK: - Helpers

  private nonisolated func sha256OfFile(at url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hasher = SHA256()
    while true {
      guard let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty else { break }
      autoreleasepool { hasher.update(data: chunk) }
    }
    let digest = hasher.finalize()
    return digest.map { String(format: "%02x", $0) }.joined()
  }
}

// MARK: - URL session download wrapper

private final class ModelDownloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
  private var continuation: CheckedContinuation<URL, Error>?
  private let progressHandler: @Sendable (Int64, Int64) -> Void
  private var didFinish = false
  private var task: URLSessionDownloadTask?

  init(progressHandler: @Sendable @escaping (Int64, Int64) -> Void) {
    self.progressHandler = progressHandler
  }

  func download(from url: URL) async throws -> URL {
    return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<URL, Error>) in
      self.continuation = cont
      let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
      var request = URLRequest(url: url)
      request.timeoutInterval = 60
      let task = session.downloadTask(with: request)
      self.task = task
      task.resume()
    }
  }

  /// Cancel the download. The delegate's didCompleteWithError fires with
  /// URLError.cancelled, which downloadModelFile maps to downloadCancelled.
  func cancel() {
    task?.cancel()
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    // Move to a stable temp location synchronously, before this delegate method returns
    // (the system deletes `location` after we return).
    let stableTemp = FileManager.default.temporaryDirectory
      .appendingPathComponent("expo-ai-kit-\(UUID().uuidString)")
    do {
      try FileManager.default.moveItem(at: location, to: stableTemp)
      didFinish = true
      continuation?.resume(returning: stableTemp)
      continuation = nil
    } catch {
      didFinish = true
      continuation?.resume(throwing: error)
      continuation = nil
    }
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64,
    totalBytesExpectedToWrite: Int64
  ) {
    progressHandler(totalBytesWritten, totalBytesExpectedToWrite)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard !didFinish else { return }
    if let error = error {
      continuation?.resume(throwing: error)
    } else if let httpResp = task.response as? HTTPURLResponse, !(200...299).contains(httpResp.statusCode) {
      continuation?.resume(throwing: NSError(
        domain: "ExpoAiKit.Download",
        code: httpResp.statusCode,
        userInfo: [NSLocalizedDescriptionKey: "HTTP \(httpResp.statusCode)"]
      ))
    } else {
      continuation?.resume(throwing: NSError(
        domain: "ExpoAiKit.Download",
        code: -1,
        userInfo: [NSLocalizedDescriptionKey: "Download finished without file"]
      ))
    }
    continuation = nil
  }
}

// MARK: - Errors

enum GemmaError: LocalizedError {
  case modelNotDownloaded(String)
  case modelLoadFailed(String, reason: String)
  case inferenceFailed(String, reason: String)
  case downloadFailed(String, reason: String)
  case downloadCancelled(String)
  case downloadCorrupt(String, expected: String, actual: String)

  // Error string formatted as "<CODE>:<modelId>:<reason>" to match the
  // contract that the JS layer's ModelError parses.
  var errorDescription: String? {
    switch self {
    case .modelNotDownloaded(let id):
      return "MODEL_NOT_DOWNLOADED:\(id):Model file not found on disk"
    case .modelLoadFailed(let id, let reason):
      return "MODEL_LOAD_FAILED:\(id):\(reason)"
    case .inferenceFailed(let id, let reason):
      return "INFERENCE_FAILED:\(id):\(reason)"
    case .downloadFailed(let id, let reason):
      return "DOWNLOAD_FAILED:\(id):\(reason)"
    case .downloadCancelled(let id):
      return "DOWNLOAD_CANCELLED:\(id):Download cancelled"
    case .downloadCorrupt(let id, let expected, let actual):
      return "DOWNLOAD_CORRUPT:\(id):SHA256 mismatch: expected \(expected), got \(actual)"
    }
  }
}
