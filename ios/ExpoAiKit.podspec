require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoAiKit'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/saidkaban/expo-ai-kit' }

  s.dependency 'ExpoModulesCore'

  # LiteRT-LM C xcframework is downloaded into ios/Vendor/ on pod install.
  # Swift wrapper sources (Apache 2.0) live alongside in ios/Vendor/LiteRTLM/.
  s.prepare_command = 'bash ../scripts/install-litertlm.sh'

  s.vendored_frameworks = 'Vendor/CLiteRTLM.xcframework'

  s.source_files = [
    '*.swift',
    'Vendor/LiteRTLM/*.swift',
  ]

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
end
