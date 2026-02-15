# AGENTS.md

Guidelines for AI coding agents working in this repository.

## Project Overview

Nostria Signer is a Chrome/Chromium browser extension (Manifest V3) and PWA built with Angular 14 and TypeScript 4.8. It provides a non-custodial HD wallet for Nostr identities.

There are two separately compiled codebases:
- **`angular/`** -- The Angular UI app (popup, options, tabs, side panel)
- **`extension/`** -- Browser extension scripts (background service worker, content script, page-context provider) compiled with webpack

Output goes to `dist/extension/`.

## Build Commands

```bash
# Install dependencies (use --force for build, npm ci for clean install)
npm install --force
npm ci

# Development (watch mode, parallel Angular + extension)
npm start

# Production build
npm run build:production

# Build Angular only (dev / prod)
npm run build:angular
npm run build:angular-production

# Build extension only (dev / prod)
npm run build:extension
npm run build:extension-production

# Package for distribution (build + zip)
npm run pack:production

# Clean build output
npm run clean
```

## Test Commands

Testing uses Jasmine 4.3 + Karma 6.4. Test files are colocated with source files using the `*.spec.ts` pattern.

```bash
# Run all tests (interactive, opens Chrome)
npm test

# Run all tests headless (CI mode)
npm run test:headless

# Run tests headless (equivalent, used in CI)
npm test -- --no-watch --no-progress --browsers=ChromeHeadless

# Run a single test file -- Karma doesn't natively support single-file runs.
# Instead, use fdescribe() or fit() in the spec file to focus on specific
# tests/suites, then run `npm test`. Remove the f-prefix before committing.
```

There is no ESLint or standalone lint command configured.

## CI

Pull requests run `npm ci`, then tests (strict -- must pass), then full build. The build workflow on push to master/main is more lenient (continue-on-error on some steps). Node 18 is used in CI.

## Code Style

### Formatting
- **Indentation**: 2 spaces (all files)
- **Charset**: UTF-8
- **Final newline**: yes
- **Trailing whitespace**: trimmed (except Markdown)
- **Max line length**: 240 characters (not enforced by a linter)
- **Quotes**: single quotes for TypeScript strings
- **Styling**: SCSS

No ESLint or Prettier config files exist. The `.editorconfig` is the canonical formatting reference. VS Code settings set `vscode.typescript-language-features` as the default TS formatter.

### TypeScript Configuration
- `strict: true` with `strictNullChecks: false` (Angular tsconfig)
- `target: ES2020`, `module: ES2020`
- `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`
- `strictTemplates: true` in Angular compiler options
- The extension tsconfig is less strict (most strict options commented out)

### File Naming
- All files: **kebab-case** (`wallet-manager.ts`, `crypto.service.ts`, `nostr-sign-event-handler.ts`)
- Angular components: `*.component.ts` with `app-` selector prefix
- Services: `*.service.ts`
- Test files: `*.spec.ts` (colocated with source)
- Barrel exports: `index.ts` in each module directory

### Class and Variable Naming
- Classes: **PascalCase** with descriptive suffix (`CryptoService`, `WalletManager`, `WalletStore`, `NostrSignEventHandler`)
- Interfaces: **PascalCase**, no `I` prefix (`ActionHandler`, `Permission`, `Wallet`, `Network`)
- Constants: **UPPER_SNAKE_CASE** (`EXTENSION_ID`, `LEGACY_PROVIDER_ID`)
- Variables/properties: **camelCase**
- Angular component selectors: **kebab-case** with `app-` prefix

### Import Conventions
- **Order** (not strictly enforced): Angular imports, then third-party packages, then local/relative
- **Path aliases**: Use `src/shared` for shared code imports from within Angular app (e.g., `import { WalletStore } from 'src/shared'`)
- **Relative imports**: Used within the same module (`'./services'`, `'../../shared/interfaces'`)
- **Extension files**: Use relative paths back to Angular shared code (`'../../angular/src/shared/...'`)
- **Barrel exports**: Prefer importing from `index.ts` barrels (`'src/shared'`, `'./services'`)
- Some legacy `require()` calls exist for CommonJS modules; prefer ES imports for new code

### Types
- Prefer `interface` over `type` for data structures
- `any` is used in the codebase but should be minimized in new code
- Generic store base classes exist: `StoreBase<T>`, `StoreListBase<T>`
- Use `async/await` for asynchronous operations

### Error Handling
- Wrap async operations in `try/catch` with `console.error()` or `console.warn()`
- Extension messaging returns errors as `{ error: { message: string, stack?: string } }` objects
- Empty catch blocks with `// Ignore errors` comments are acceptable for non-critical operations

## Architecture

### Shared Code (`angular/src/shared/`)
Shared code must **never** depend on Angular. It is used by both the Angular UI app and the background service worker. This includes stores, interfaces, handlers, network definitions, and crypto utilities.

### Extension Messaging Flow
`provider.ts` (page context, MAIN world) -> `content.ts` (content script, ISOLATED world) -> `background.ts` (service worker) -> response flows back through the chain.

### Key Patterns
- **Action Handler**: Interface with `prepare()` and `execute()` methods; factory via `Handlers.getAction()`
- **Store**: `StoreBase<T>` and `StoreListBase<T>` with IndexedDB persistence via `idb` library
- **Permission system**: Queue-based request handling with popup prompts
- **NIP-07**: Implements `globalThis.nostr` with `getPublicKey()`, `signEvent()`, `nip04`, `nip44`

### Key Dependencies
- **Crypto**: `@noble/secp256k1`, `@scure/bip32`, `@scure/bip39`, `nostr-tools` 2.15
- **DID/VC**: `did-jwt`, `did-jwt-vc`, `@blockcore/identity`
- **Bitcoin**: `@blockcore/blockcore-js`, `bitcoinjs-message`, `coinselect`, `ecpair`
- **Browser extension**: `webextension-polyfill`
- **Storage**: `idb` (IndexedDB wrapper)
- **i18n**: `@ngx-translate/core`

## Common Pitfalls
- Node polyfills (Buffer, stream, crypto) are provided via webpack; do not assume Node globals are available without checking webpack config
- The Angular build uses `@angular-builders/custom-webpack` to merge custom webpack config
- `strictNullChecks` is **disabled** -- be aware that null/undefined checks are not enforced by the compiler
- Many existing spec files have tests commented out; when adding tests, ensure they actually run
- Use `fdescribe`/`fit` for focusing tests during development, but never commit them
