import ExpoModulesCore
import FoundationModels
import NaturalLanguage

public class ExpoAiKitModule: Module {
  // Track active streaming tasks for cancellation
  private var activeStreamTasks: [String: Task<Void, Never>] = [:]
  // Track in-flight (non-streaming) sendMessage tasks so stopStreaming can cancel them.
  private var activeSendTasks: [String: Task<[String: Any], Error>] = [:]

  // Active model ID: "apple-fm" (default) or a downloadable model ID
  private var activeModelId: String = "apple-fm"

  // Best-effort sampling defaults for the active session (set by setModel).
  // Only the Apple FM path reads this; Gemma applies sampling at conversation creation.
  private var generationConfig: [String: Double] = [:]

  // Gemma/LiteRT-LM client. Constructor is cheap — no engine load until setModel.
  private let gemmaClient = GemmaInferenceClient()

  // Embedding model identifiers with an OS asset request currently in flight
  // (lets getEmbeddingModelStatus report "downloading").
  private var embeddingAssetRequests: Set<String> = []

  // Build Apple Foundation Models generation options from the stored config.
  @available(iOS 26.0, *)
  private func appleGenerationOptions() -> GenerationOptions {
    let temperature = generationConfig["temperature"]
    let maxTokens = generationConfig["maxTokens"].map { Int($0) }
    return GenerationOptions(temperature: temperature, maximumResponseTokens: maxTokens)
  }

  // ==================================================================
  // Embedding helpers (Apple NLContextualEmbedding, iOS 17+)
  // ==================================================================

  // Fallback candidates for getSupportedEmbeddingLanguages, probed only if the
  // NLContextualEmbedding catalog API unexpectedly returns nothing.
  private static let probeEmbeddingLanguages: [String] = [
    "en", "fr", "de", "es", "it", "pt", "nl", "sv", "da", "nb", "fi", "pl", "cs",
    "sk", "hu", "ro", "hr", "ca", "tr", "vi", "id", "ms", "tl",
    "ru", "uk", "bg", "sr", "kk",
    "zh-Hans", "zh-Hant", "ja", "ko",
  ]

  /// Resolve the contextual-embedding model for a normalized BCP-47 tag.
  /// Tries the full tag, then language-script, then the bare language subtag
  /// (so "en-US" resolves via "en" while "zh-Hans" resolves directly), and
  /// throws a typed LANGUAGE_NOT_SUPPORTED error naming the rejected language.
  /// Deliberately no cross-language fallback: an unsupported language must
  /// never silently produce Latin-model vectors.
  @available(iOS 17.0, *)
  private func resolveEmbeddingModel(language: String) throws -> (model: NLContextualEmbedding, language: NLLanguage) {
    var candidates: [String] = [language]
    let parts = language.split(separator: "-").map(String.init)
    if parts.count >= 2 {
      if parts[1].count == 4 {
        candidates.append("\(parts[0])-\(parts[1])")
      }
      candidates.append(parts[0])
    }
    var seen = Set<String>()
    for candidate in candidates where seen.insert(candidate).inserted {
      let nlLanguage = NLLanguage(rawValue: candidate)
      if let model = NLContextualEmbedding(language: nlLanguage) {
        return (model, nlLanguage)
      }
    }
    throw NSError(
      domain: "ExpoAiKit", code: 0,
      userInfo: [NSLocalizedDescriptionKey:
        "LANGUAGE_NOT_SUPPORTED::No on-device embedding model supports language \"\(language)\". " +
        "iOS ships script-based models (Latin / Cyrillic / CJK) — call getSupportedEmbeddingLanguages() for the list."]
    )
  }

  /// Ensure the model's assets are on-device, asking the OS to fetch them if
  /// needed — the same on-demand flow embed() has always used, now per model.
  @available(iOS 17.0, *)
  private func ensureEmbeddingAssets(_ model: NLContextualEmbedding) async throws {
    if model.hasAvailableAssets { return }
    self.embeddingAssetRequests.insert(model.modelIdentifier)
    defer { self.embeddingAssetRequests.remove(model.modelIdentifier) }
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      model.requestAssets { result, error in
        if let error = error {
          cont.resume(throwing: error)
        } else if result == .available {
          cont.resume(returning: ())
        } else {
          cont.resume(throwing: NSError(
            domain: "ExpoAiKit", code: 0,
            userInfo: [NSLocalizedDescriptionKey:
              "DOWNLOAD_FAILED::The OS reports the embedding assets for \(model.modelIdentifier) as unavailable on this device"]
          ))
        }
      }
    }
  }

  @available(iOS 17.0, *)
  private func embeddingModelIdentity(_ model: NLContextualEmbedding) -> [String: Any] {
    return ["id": model.modelIdentifier, "revision": String(model.revision)]
  }

  public func definition() -> ModuleDefinition {
    Name("ExpoAiKit")

    // Declare events that can be sent to JavaScript
    Events("onStreamToken", "onDownloadProgress", "onModelStateChange")

    // ==================================================================
    // Inference API
    // ==================================================================

    Function("isAvailable") { () -> Bool in
      // iOS 26 alone isn't enough: Apple Intelligence must be enabled and the
      // model actually available on this device. Check the real availability.
      if #available(iOS 26.0, *) {
        if case .available = SystemLanguageModel.default.availability {
          return true
        }
        return false
      }
      return false
    }

    AsyncFunction("sendMessage") {
      (
        messages: [[String: Any]],
        fallbackSystemPrompt: String,
        sessionId: String
      ) async throws -> [String: Any] in

      let baseSystemPrompt =
        messages
        .first { ($0["role"] as? String) == "system" }?["content"] as? String
        ?? (fallbackSystemPrompt.isEmpty
          ? "You are a helpful, friendly assistant."
          : fallbackSystemPrompt)

      let nonSystemMessages = messages.filter { ($0["role"] as? String) != "system" }

      // Wrap in a tracked Task so stopStreaming(sessionId) can cancel it.
      let task = Task { () async throws -> [String: Any] in
        if self.activeModelId == "apple-fm" {
          // Apple FM: role-prefixed conversation prompt (FM has no native turn API in our usage).
          let conversationPrompt = nonSystemMessages
            .map { msg -> String in
              let role = (msg["role"] as? String ?? "user").uppercased()
              let content = msg["content"] as? String ?? ""
              return "\(role): \(content)"
            }
            .joined(separator: "\n") + "\nASSISTANT:"

          if #available(iOS 26.0, *) {
            let session = LanguageModelSession(instructions: baseSystemPrompt)
            let response = try await session.respond(
              to: conversationPrompt, options: self.appleGenerationOptions()
            )
            return ["text": response.content]
          } else {
            return ["text": "[On-device AI requires iOS 26+]"]
          }
        } else {
          // Gemma/LiteRT-LM: Conversation API handles turn formatting; pass raw content joined.
          let conversationPrompt = nonSystemMessages
            .map { ($0["content"] as? String) ?? "" }
            .joined(separator: "\n")

          let text = try await self.gemmaClient.generateText(
            prompt: conversationPrompt, systemPrompt: baseSystemPrompt
          )
          return ["text": text]
        }
      }
      self.activeSendTasks[sessionId] = task
      defer { self.activeSendTasks.removeValue(forKey: sessionId) }
      return try await task.value
    }

    AsyncFunction("startStreaming") {
      (
        messages: [[String: Any]],
        fallbackSystemPrompt: String,
        sessionId: String
      ) in

      let baseSystemPrompt =
        messages
        .first { ($0["role"] as? String) == "system" }?["content"] as? String
        ?? (fallbackSystemPrompt.isEmpty
          ? "You are a helpful, friendly assistant."
          : fallbackSystemPrompt)

      let nonSystemMessages = messages.filter { ($0["role"] as? String) != "system" }

      if self.activeModelId == "apple-fm" {
        let conversationPrompt = nonSystemMessages
          .map { msg -> String in
            let role = (msg["role"] as? String ?? "user").uppercased()
            let content = msg["content"] as? String ?? ""
            return "\(role): \(content)"
          }
          .joined(separator: "\n") + "\nASSISTANT:"

        if #available(iOS 26.0, *) {
          let task = Task {
            do {
              let session = LanguageModelSession(instructions: baseSystemPrompt)
              let stream = session.streamResponse(
                to: conversationPrompt, options: self.appleGenerationOptions()
              )
              var accumulatedText = ""

              for try await partialResponse in stream {
                if Task.isCancelled { break }
                let currentText = partialResponse.content
                let newToken = String(currentText.dropFirst(accumulatedText.count))
                accumulatedText = currentText

                self.sendEvent("onStreamToken", [
                  "sessionId": sessionId,
                  "token": newToken,
                  "accumulatedText": accumulatedText,
                  "isDone": false
                ])
              }

              // Always emit terminal done — covers normal completion AND cancellation —
              // so the JS stream settles instead of hanging.
              self.sendEvent("onStreamToken", [
                "sessionId": sessionId,
                "token": "",
                "accumulatedText": accumulatedText,
                "isDone": true
              ])
            } catch {
              self.sendEvent("onStreamToken", [
                "sessionId": sessionId,
                "token": "",
                "accumulatedText": "[Error: \(error.localizedDescription)]",
                "isDone": true
              ])
            }
            self.activeStreamTasks.removeValue(forKey: sessionId)
          }
          self.activeStreamTasks[sessionId] = task
        } else {
          self.sendEvent("onStreamToken", [
            "sessionId": sessionId,
            "token": "[On-device AI requires iOS 26+]",
            "accumulatedText": "[On-device AI requires iOS 26+]",
            "isDone": true
          ])
        }
      } else {
        // Gemma/LiteRT-LM path
        let conversationPrompt = nonSystemMessages
          .map { ($0["content"] as? String) ?? "" }
          .joined(separator: "\n")

        let task = Task {
          do {
            try await self.gemmaClient.generateTextStream(
              prompt: conversationPrompt,
              systemPrompt: baseSystemPrompt
            ) { token, accumulatedText, isDone in
              self.sendEvent("onStreamToken", [
                "sessionId": sessionId,
                "token": token,
                "accumulatedText": accumulatedText,
                "isDone": isDone
              ])
            }
          } catch {
            self.sendEvent("onStreamToken", [
              "sessionId": sessionId,
              "token": "",
              "accumulatedText": "[Error: \(error.localizedDescription)]",
              "isDone": true
            ])
          }
          self.activeStreamTasks.removeValue(forKey: sessionId)
        }
        self.activeStreamTasks[sessionId] = task
      }
    }

    AsyncFunction("stopStreaming") { (sessionId: String) in
      if let task = self.activeStreamTasks[sessionId] {
        task.cancel()
        self.activeStreamTasks.removeValue(forKey: sessionId)
      }
      if let task = self.activeSendTasks[sessionId] {
        task.cancel()
        self.activeSendTasks.removeValue(forKey: sessionId)
      }
    }

    // ==================================================================
    // Embeddings
    // ==================================================================
    // Apple's NLContextualEmbedding is a zero-download, OS-maintained model
    // (NaturalLanguage framework, iOS 17+). It yields one contextual vector per
    // token; we mean-pool over a text's tokens to get a single sentence vector.
    // Models are script-based (Latin / Cyrillic / CJK) and selected by the
    // caller's `language` (BCP-47, normalized by the JS layer); their assets
    // are downloaded on demand by the OS, not bundled into the app.
    // Independent of the FoundationModels generation path, so none of this is
    // gated by the single-flight inference guard.

    AsyncFunction("embed") { (texts: [String], task: String, language: String) async throws -> [String: Any] in
      if #available(iOS 17.0, *) {
        // `task` is accepted as semantic intent only on iOS: NLContextualEmbedding
        // has no task conditioning. (Android maps it onto EmbeddingGemma's
        // prompt protocol.) `language` picks the script model — and is passed
        // to the tokenizer below, so the same language drives both.
        _ = task
        let (model, nlLanguage) = try self.resolveEmbeddingModel(language: language)

        // First use may need the OS to fetch the model asset.
        try await self.ensureEmbeddingAssets(model)

        try model.load()

        let dimension = model.dimension
        var embeddings: [[Double]] = []
        embeddings.reserveCapacity(texts.count)

        for text in texts {
          // An empty string has no tokens — return a zero vector so output length
          // always matches input length (callers index embeddings[i] by texts[i]).
          if text.isEmpty {
            embeddings.append([Double](repeating: 0.0, count: dimension))
            continue
          }

          let result = try model.embeddingResult(for: text, language: nlLanguage)
          var sum = [Double](repeating: 0.0, count: dimension)
          var count = 0
          result.enumerateTokenVectors(in: text.startIndex..<text.endIndex) {
            (vector, _) -> Bool in
            let n = min(sum.count, vector.count)
            for i in 0..<n { sum[i] += vector[i] }
            count += 1
            return true
          }
          if count > 0 {
            for i in 0..<sum.count { sum[i] /= Double(count) }
          }
          embeddings.append(sum)
        }

        return [
          "embeddings": embeddings,
          "dimensions": dimension,
          "model": self.embeddingModelIdentity(model),
        ]
      } else {
        throw NSError(
          domain: "ExpoAiKit", code: 0,
          userInfo: [NSLocalizedDescriptionKey:
            "DEVICE_NOT_SUPPORTED::On-device embeddings require iOS 17 or later"]
        )
      }
    }

    AsyncFunction("getEmbeddingModelStatus") { (language: String) async throws -> [String: Any] in
      guard #available(iOS 17.0, *) else {
        throw NSError(
          domain: "ExpoAiKit", code: 0,
          userInfo: [NSLocalizedDescriptionKey:
            "DEVICE_NOT_SUPPORTED::On-device embeddings require iOS 17 or later"]
        )
      }
      let (model, _) = try self.resolveEmbeddingModel(language: language)
      let status: String
      if self.embeddingAssetRequests.contains(model.modelIdentifier) {
        status = "downloading"
      } else {
        status = model.hasAvailableAssets ? "downloaded" : "not-downloaded"
      }
      return [
        "status": status,
        // OS-managed asset — its size is not exposed by the API.
        "sizeBytes": 0,
        "model": self.embeddingModelIdentity(model),
      ]
    }

    AsyncFunction("prepareEmbeddingModel") { (url: String, sha256: String, language: String) async throws in
      // url/sha256 pin Android's Google-hosted bundle; iOS assets are
      // OS-managed and fetched per script model, so both are ignored here.
      _ = url
      _ = sha256
      guard #available(iOS 17.0, *) else {
        throw NSError(
          domain: "ExpoAiKit", code: 0,
          userInfo: [NSLocalizedDescriptionKey:
            "DEVICE_NOT_SUPPORTED::On-device embeddings require iOS 17 or later"]
        )
      }
      let (model, _) = try self.resolveEmbeddingModel(language: language)
      try await self.ensureEmbeddingAssets(model)
    }

    AsyncFunction("cancelEmbeddingModelDownload") { () async in
      // No-op: iOS embedding assets are OS-managed, so there is no app-owned
      // download to cancel (Android cancels its EmbeddingGemma download here).
    }

    AsyncFunction("deleteEmbeddingModel") { () async in
      // No-op: the app cannot delete OS-managed NLContextualEmbedding assets
      // (Android deletes its per-app EmbeddingGemma file here).
    }

    AsyncFunction("getSupportedEmbeddingLanguages") { () async -> [String] in
      guard #available(iOS 17.0, *) else { return [] }
      var languages = Set<String>()
      // The catalog API enumerates every available contextual-embedding model.
      let catalog = NLContextualEmbedding.contextualEmbeddings(forValues: [:])
      for model in catalog {
        for language in model.languages {
          languages.insert(language.rawValue)
        }
      }
      if languages.isEmpty {
        // Defensive fallback: probe known candidates one by one.
        for tag in Self.probeEmbeddingLanguages {
          if NLContextualEmbedding(language: NLLanguage(rawValue: tag)) != nil {
            languages.insert(tag)
          }
        }
      }
      return languages.sorted()
    }

    // ==================================================================
    // Model discovery
    // ==================================================================

    Function("getBuiltInModels") { () -> [[String: Any]] in
      var available = false
      if #available(iOS 26.0, *) {
        if case .available = SystemLanguageModel.default.availability {
          available = true
        }
      }
      return [
        [
          "id": "apple-fm",
          "name": "Apple Foundation Model",
          "available": available,
          "platform": "ios",
          "contextWindow": 4096
        ]
      ]
    }

    AsyncFunction("getDownloadableModelStatus") { (modelId: String) async -> String in
      let loadedId = await self.gemmaClient.getLoadedModelId()
      let isLoaded = await self.gemmaClient.isModelLoaded()
      if loadedId == modelId && isLoaded {
        return "ready"
      }
      // File on disk but not loaded -> "downloaded". This is what lets callers
      // skip a redundant (re-)download across app launches.
      if self.gemmaClient.isModelFileDownloaded(modelId) {
        return "downloaded"
      }
      return "not-downloaded"
    }

    Function("getDeviceRamBytes") { () -> Int in
      return Int(ProcessInfo.processInfo.physicalMemory)
    }

    // ==================================================================
    // Model selection & memory management
    // ==================================================================

    AsyncFunction("setModel") { (modelId: String, minRamBytes: Int, backend: String, generation: [String: Double]) async throws in
      // Sampling defaults for this session. Apple FM reads this per-call; Gemma
      // applies it below at conversation creation.
      self.generationConfig = generation
      if modelId == "apple-fm" {
        if await self.gemmaClient.isModelLoaded() {
          let previousId = self.activeModelId
          await self.gemmaClient.unloadModel()
          if previousId != "apple-fm" {
            self.sendEvent("onModelStateChange", [
              "modelId": previousId,
              "status": self.gemmaClient.isModelFileDownloaded(previousId) ? "downloaded" : "not-downloaded"
            ])
          }
        }
        self.activeModelId = "apple-fm"
        return
      }

      // Downloadable model: verify file exists
      if !self.gemmaClient.isModelFileDownloaded(modelId) {
        throw NSError(
          domain: "ExpoAiKit",
          code: 0,
          userInfo: [NSLocalizedDescriptionKey: "MODEL_NOT_DOWNLOADED:\(modelId):Model file not found on disk"]
        )
      }

      self.sendEvent("onModelStateChange", [
        "modelId": modelId,
        "status": "loading"
      ])

      do {
        try await self.gemmaClient.loadModel(
          modelId: modelId,
          backend: backend,
          temperature: generation["temperature"].map { Float($0) },
          topK: generation["topK"].map { Int($0) },
          topP: generation["topP"].map { Float($0) },
          seed: generation["seed"].map { Int($0) }
        )
        self.activeModelId = modelId
        self.sendEvent("onModelStateChange", [
          "modelId": modelId,
          "status": "ready"
        ])
      } catch {
        // Load failed, but the file is still on disk -> "downloaded", not "not-downloaded".
        self.sendEvent("onModelStateChange", [
          "modelId": modelId,
          "status": self.gemmaClient.isModelFileDownloaded(modelId) ? "downloaded" : "not-downloaded"
        ])
        throw error
      }
    }

    Function("getActiveModel") { () -> String in
      return self.activeModelId
    }

    AsyncFunction("unloadModel") { () async in
      if self.activeModelId != "apple-fm", await self.gemmaClient.isModelLoaded() {
        let previousId = self.activeModelId
        await self.gemmaClient.unloadModel()
        self.activeModelId = "apple-fm"
        self.sendEvent("onModelStateChange", [
          "modelId": previousId,
          "status": self.gemmaClient.isModelFileDownloaded(previousId) ? "downloaded" : "not-downloaded"
        ])
      }
    }

    // ==================================================================
    // Model lifecycle (downloadable models only)
    // ==================================================================

    AsyncFunction("downloadModel") {
      (modelId: String, url: String, sha256: String) async throws in

      self.sendEvent("onModelStateChange", [
        "modelId": modelId,
        "status": "downloading"
      ])

      do {
        try await self.gemmaClient.downloadModelFile(
          modelId: modelId, urlString: url, sha256: sha256
        ) { bytesRead, totalBytes in
          self.sendEvent("onDownloadProgress", [
            "modelId": modelId,
            "progress": totalBytes > 0 ? Double(bytesRead) / Double(totalBytes) : 0.0
          ])
        }

        // Download succeeded: file is on disk, awaiting setModel() to load it.
        self.sendEvent("onModelStateChange", [
          "modelId": modelId,
          "status": "downloaded"
        ])
      } catch {
        // On failure, report whatever is actually on disk (a prior good copy may remain).
        self.sendEvent("onModelStateChange", [
          "modelId": modelId,
          "status": self.gemmaClient.isModelFileDownloaded(modelId) ? "downloaded" : "not-downloaded"
        ])
        throw error
      }
    }

    AsyncFunction("cancelDownload") { (modelId: String) async in
      await self.gemmaClient.cancelDownload(modelId)
    }

    AsyncFunction("deleteModel") { (modelId: String) async in
      if self.activeModelId == modelId {
        self.activeModelId = "apple-fm"
      }
      await self.gemmaClient.deleteModelFile(modelId: modelId)
      self.sendEvent("onModelStateChange", [
        "modelId": modelId,
        "status": "not-downloaded"
      ])
    }
  }
}
