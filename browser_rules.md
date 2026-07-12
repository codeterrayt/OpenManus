# Web Browsing & HTML Selector Protocol

- **Find-Before-Act Protocol**: Before calling any `browse_web` action (except 'extract_text' or 'screenshot'), you MUST call `inspect_page_html` with a search query to find the element first.
- **No Guessing**: Under no circumstances should you ever call `browse_web` with a guessed selector. Guessing selectors will fail.
- **State Selection explicitly**: In your thought process immediately preceding the browse_web action call, you MUST explicitly write:
  - "I have inspected the page for element matching '<query>'."
  - "The cssSelector from the inspect result is '<cssSelector>' (or xpath is '<xpath>')."
- **Correction**: If browse_web returns an error, do not repeat the same call. Run `inspect_page_html` again with a different query, or use `evaluate` to click the element via JavaScript.
