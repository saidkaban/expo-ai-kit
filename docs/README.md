# expo-ai-kit documentation

The Next.js application behind [expo-ai-kit.dev](https://expo-ai-kit.dev). It lives in the library
repository so API and documentation changes can be reviewed together.

## Local development

```bash
cd docs
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Before committing documentation changes, run:

```bash
npm run check
```

`check` validates internal links, ESLint, and the production build.

## Deployment

The production site is deployed from this repository with `docs` configured as the Vercel Root
Directory. Next.js defaults handle the build and output settings.
