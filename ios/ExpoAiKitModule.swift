import ExpoModulesCore
import FoundationModels

public class ExpoAiKitModule: Module {
  // Track active streaming tasks for cancellation
  private var activeStreamTasks: [String: Task<Void, Never>] = [:]

  // Active model ID: "apple-fm" (default) or a downloadable model ID
  private var activeModelId: String = "apple-fm"

  public func definition() -> ModuleDefinition {
    Name("ExpoAiKit")

    // Declare events that can be sent to JavaScript
    Events("onStreamToken", "onDownloadProgress", "onModelStateChange")

    // ==================================================================
    // Existing inference API -- Apple Foundation Models path unchanged
    // ==================================================================

    Function("isAvailable") {
      if #available(iOS 26.0, *) {
        return true
      } else {
        return false
      }
    }

    AsyncFunction("sendMessage") {
      (
        messages: [[String: Any]],
        fallbackSystemPrompt: String
      ) async throws -> [String: Any] in

      // Extract base system prompt from messages, or use fallback
      let baseSystemPrompt =
        messages
        .first { ($0["role"] as? String) == "system" }?["content"] as? String
        ?? (fallbackSystemPrompt.isEmpty
          ? "You are a helpful, friendly assistant."
          : fallbackSystemPrompt)

      // Build conversation history prompt from all non-system messages
      // On-device models are stateless, so we must include full history in each request
      let conversationPrompt = messages
        .filter { ($0["role"] as? String) != "system" }
        .map { msg -> String in
          let role = (msg["role"] as? String ?? "user").uppercased()
          let content = msg["content"] as? String ?? ""
          return "\(role): \(content)"
        }
        .joined(separator: "\n") + "\nASSISTANT:"

      if #available(iOS 26.0, *) {
        let session = LanguageModelSession(instructions: baseSystemPrompt)
        let response = try await session.respond(to: conversationPrompt)
        return ["text": response.content]
      } else {
        return ["text": "[On-device AI requires iOS 26+]"]
      }
    }

    AsyncFunction("startStreaming") {
      (
        messages: [[String: Any]],
        fallbackSystemPrompt: String,
        sessionId: String
      ) in

      // Extract base system prompt from messages, or use fallback
      let baseSystemPrompt =
        messages
        .first { ($0["role"] as? String) == "system" }?["content"] as? String
        ?? (fallbackSystemPrompt.isEmpty
          ? "You are a helpful, friendly assistant."
          : fallbackSystemPrompt)

      // Build conversation history prompt from all non-system messages
      // On-device models are stateless, so we must include full history in each request
      let conversationPrompt = messages
        .filter { ($0["role"] as? String) != "system" }
        .map { msg -> String in
          let role = (msg["role"] as? String ?? "user").uppercased()
          let content = msg["content"] as? String ?? ""
          return "\(role): \(content)"
        }
        .joined(separator: "\n") + "\nASSISTANT:"

      if #available(iOS 26.0, *) {
        // Create a task for streaming that can be cancelled
        let task = Task {
          do {
            let session = LanguageModelSession(instructions: baseSystemPrompt)
            let stream = session.streamResponse(to: conversationPrompt)
            var accumulatedText = ""

            for try await partialResponse in stream {
              // Check for cancellation
              if Task.isCancelled { break }

              let currentText = partialResponse.content
              let newToken = String(currentText.dropFirst(accumulatedText.count))
              accumulatedText = currentText

              // Send token event to JavaScript
              self.sendEvent("onStreamToken", [
                "sessionId": sessionId,
                "token": newToken,
                "accumulatedText": accumulatedText,
                "isDone": false
              ])
            }

            // Send final event
            if !Task.isCancelled {
              self.sendEvent("onStreamToken", [
                "sessionId": sessionId,
                "token": "",
                "accumulatedText": accumulatedText,
                "isDone": true
              ])
            }
          } catch {
            // Send error as final event
            self.sendEvent("onStreamToken", [
              "sessionId": sessionId,
              "token": "",
              "accumulatedText": "[Error: \(error.localizedDescription)]",
              "isDone": true
            ])
          }

          // Clean up
          self.activeStreamTasks.removeValue(forKey: sessionId)
        }

        self.activeStreamTasks[sessionId] = task
      } else {
        // Fallback for older iOS versions - send single response
        self.sendEvent("onStreamToken", [
          "sessionId": sessionId,
          "token": "[On-device AI requires iOS 26+]",
          "accumulatedText": "[On-device AI requires iOS 26+]",
          "isDone": true
        ])
      }
    }

    AsyncFunction("stopStreaming") { (sessionId: String) in
      if let task = self.activeStreamTasks[sessionId] {
        task.cancel()
        self.activeStreamTasks.removeValue(forKey: sessionId)
      }
    }

    // ==================================================================
    // Model discovery
    // ==================================================================

    Function("getBuiltInModels") { () -> [[String: Any]] in
      var available = false
      if #available(iOS 26.0, *) {
        available = true
      }
      return [
        [
          "id": "apple-fm",
          "name": "Apple Foundation Model",
          "available": available,
          "platform": "ios",
          // Apple FM context window is not publicly documented; use conservative default
          "contextWindow": 4096
        ]
      ]
    }

    Function("getDownloadableModelStatus") { (modelId: String) -> String in
      // No downloadable models supported on iOS yet (Phase 3: llama.cpp)
      return "not-downloaded"
    }

    Function("getDeviceRamBytes") { () -> Int in
      return Int(ProcessInfo.processInfo.physicalMemory)
    }

    // ==================================================================
    // Model selection & memory management
    // ==================================================================

    AsyncFunction("setModel") { (modelId: String) in
      if modelId == "apple-fm" {
        self.activeModelId = "apple-fm"
        return
      }
      // Downloadable models not yet supported on iOS
      throw NSError(
        domain: "ExpoAiKit",
        code: 0,
        userInfo: [NSLocalizedDescriptionKey: "MODEL_LOAD_FAILED:\(modelId):Downloadable models are not yet supported on iOS. Coming in a future release (Phase 3: llama.cpp)."]
      )
    }

    Function("getActiveModel") { () -> String in
      return self.activeModelId
    }

    AsyncFunction("unloadModel") { () in
      // No downloadable model can be loaded on iOS yet; just reset to default
      self.activeModelId = "apple-fm"
    }

    // ==================================================================
    // Model lifecycle (downloadable models only -- stubs for iOS)
    // ==================================================================

    AsyncFunction("downloadModel") { (modelId: String, url: String, sha256: String) in
      throw NSError(
        domain: "ExpoAiKit",
        code: 0,
        userInfo: [NSLocalizedDescriptionKey: "DOWNLOAD_FAILED:\(modelId):Downloadable models are not yet supported on iOS. Coming in a future release (Phase 3: llama.cpp)."]
      )
    }

    AsyncFunction("deleteModel") { (modelId: String) in
      throw NSError(
        domain: "ExpoAiKit",
        code: 0,
        userInfo: [NSLocalizedDescriptionKey: "MODEL_NOT_FOUND:\(modelId):Downloadable models are not yet supported on iOS. Coming in a future release (Phase 3: llama.cpp)."]
      )
    }
  }
}
