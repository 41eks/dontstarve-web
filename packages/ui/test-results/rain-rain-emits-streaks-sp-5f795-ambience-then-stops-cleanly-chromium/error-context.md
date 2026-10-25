# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: rain.spec.ts >> rain emits streaks, splashes and the intensity-driven ambience, then stops cleanly
- Location: tests/rain.spec.ts:4:1

# Error details

```
Error: page.evaluate: TypeError: Cannot read properties of undefined (reading 'drawRange')
    at quads (http://127.0.0.1:4175/@fs/home/alex/projects/dontstarve-web/packages/ui/tests/rain-fixture.ts:63:37)
    at Module.checkRain (http://127.0.0.1:4175/@fs/home/alex/projects/dontstarve-web/packages/ui/tests/rain-fixture.ts:66:11)
    at async <anonymous>:337:30
```