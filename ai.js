// Subpath entry: `import { expoAiKit } from 'expo-ai-kit/ai'`.
// A root shim (instead of a package.json "exports" map) so resolution works
// across Metro, Node, and TypeScript without changing how the existing
// entry points resolve.
export * from './build/ai';
