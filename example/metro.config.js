// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// The library lives one directory up and is linked via `"expo-ai-kit": "file:.."`.
// Watch it so source edits hot-reload into the example.
config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Because the library is symlinked from the parent, Metro's default hierarchical
// lookup resolves its `import 'react-native'` (etc.) against the ROOT node_modules,
// which holds a *different* React Native than the app (devDependency vs app dep).
// Two copies in one bundle => "TurboModuleRegistry.getEnforcing('PlatformConstants')
// could not be found". Pin these singletons to the example's own copy by resolving
// them as if requested from the project root.
const SINGLETONS = ['react', 'react-native', 'expo', 'expo-modules-core'];
const shimOrigin = path.join(projectRoot, 'node_modules', '.metro-singleton-shim.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pkg = moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0];

  if (SINGLETONS.includes(pkg)) {
    return context.resolveRequest(
      { ...context, originModulePath: shimOrigin },
      moduleName,
      platform
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
