# expo-ai-kit consumer ProGuard/R8 rules (applied to apps that depend on this library).

# The optional text backend (llm config-plugin flag) is instantiated by
# reflection from ExpoAiKitModule, keep its constructor.
-keep class expo.modules.aikit.llm.AndroidLlmBackend {
    <init>(android.content.Context, expo.modules.aikit.LlmEventSink);
}

# The optional EmbeddingGemma backend (androidEmbeddings config-plugin flag) is
# instantiated by reflection from ExpoAiKitModule, keep its constructor.
-keep class expo.modules.aikit.embeddings.EmbeddingGemmaBackend {
    <init>(android.content.Context);
}

# The optional ML Kit speech backend (speech config-plugin flag) is
# instantiated by reflection from ExpoAiKitModule, keep its constructor.
-keep class expo.modules.aikit.speech.MlKitSpeechBackend {
    <init>(android.content.Context);
}

# The optional ML Kit vision backend (vision config-plugin option) is
# instantiated by reflection from ExpoAiKitModule, and it instantiates each
# compiled-in feature client the same way; keep their constructors.
-keep class expo.modules.aikit.vision.MlKitVisionBackend {
    <init>(android.content.Context);
}
-keep class expo.modules.aikit.vision.FaceDetectionClient {
    <init>(expo.modules.aikit.vision.VisionSupport);
}
-keep class expo.modules.aikit.vision.ImageLabelingClient {
    <init>(expo.modules.aikit.vision.VisionSupport);
}
-keep class expo.modules.aikit.vision.SubjectSegmentationClient {
    <init>(expo.modules.aikit.vision.VisionSupport);
}
-keep class expo.modules.aikit.vision.TextRecognitionClient {
    <init>(expo.modules.aikit.vision.VisionSupport);
}

# LiteRT-LM ships no consumer rules; its JNI layer resolves Kotlin classes by
# name. These rules are inert when the classes are absent (llm disabled).
-keep class com.google.ai.edge.litertlm.** { *; }
-dontwarn com.google.ai.edge.litertlm.**

# MediaPipe tasks-text ships no consumer rules; its JNI layer resolves Java
# classes by name. These rules are inert when the classes are absent
# (embeddings disabled).
-keep class com.google.mediapipe.** { *; }
-dontwarn com.google.mediapipe.**
