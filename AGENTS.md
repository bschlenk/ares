# Repository conventions

- Use `.js` for JavaScript ES modules inside packages with `"type": "module"`. Never use `.mjs` when the package already declares module mode.
- Write new Node helper scripts as ES modules using `.js` and `import`/`export`; do not add CommonJS `.cjs` helpers.
