/**
 * The task-brief formatting added on top of the document renderer: underline,
 * strike, highlight, super/subscript, check lists and kept line breaks. The
 * security property is the same as for documents, so it is asserted again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, stripInline, plainText } from "../src/lib/markdown";

test("renders every inline style", () => {
  const html = renderMarkdown(
    "**b** *i* ++u++ ~~s~~ ==h== x^2^ H~2~O `c`",
  );
  assert.match(html, /<strong>b<\/strong>/);
  assert.match(html, /<em>i<\/em>/);
  assert.match(html, /<u>u<\/u>/);
  assert.match(html, /<s>s<\/s>/);
  assert.match(html, /<mark>h<\/mark>/);
  assert.match(html, /x<sup>2<\/sup>/);
  assert.match(html, /H<sub>2<\/sub>O/);
  assert.match(html, /<code>c<\/code>/);
});

test("ordinary writing is not formatting", () => {
  const html = renderMarkdown("About ~5 to ~10 people, in C++ and C++.");
  assert.doesNotMatch(html, /<sub>|<u>/);
});

test("markers never reach inside links or code", () => {
  const html = renderMarkdown("[page](https://example.com/~a/~b) and `x^2^`");
  assert.match(html, /href="https:\/\/example.com\/~a\/~b"/);
  assert.match(html, /<code>x\^2\^<\/code>/);
});

test("headings, bullets and kept line breaks", () => {
  const html = renderMarkdown("## Slide 1\nTop: logo\nDate: 20 March\n\n• one\n• two", { breaks: true });
  assert.match(html, /<h2>Slide 1<\/h2>/);
  assert.match(html, /Top: logo<br \/>Date: 20 March/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
});

test("check lists", () => {
  const html = renderMarkdown("- [ ] draft\n- [x] review");
  assert.match(html, /class="hs-checklist"/);
  assert.match(html, /hs-check is-done/);
});

test("still escapes before formatting", () => {
  const html = renderMarkdown('++<img src=x onerror=alert(1)>++ ==<script>==\u0000 0\u0000');
  assert.doesNotMatch(html, /<img|<script/);
});

test("plain text strips the markers", () => {
  assert.equal(stripInline("++a++ ~~b~~ ==c== x^2^ H~2~O"), "a b c x2 H2O");
  assert.equal(plainText("# Title\n\n- **one**\n- two"), "Title · one · two");
});
