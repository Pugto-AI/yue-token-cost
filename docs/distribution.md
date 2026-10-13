# Distribution

The highest risk to this project is not code quality, it is that nobody finds it. This file is the
place to track that work; the plan deliberately does not treat it as an engineering milestone.

## Principle

Tools are forgotten; **numbers get cited**. Lead with the benchmark table (繁體/粵語 +18-24%,
tokenizer generation -35%), not with "yet another MCP server".

## Landscape (checked 2026-10-12)

Adjacent work exists; the specific combination does not.

| Existing | What it does | What it lacks |
|---|---|---|
| [`LangGPT/ohmytoken`](https://github.com/LangGPT/ohmytoken) | Token **price** intelligence for 23+ models, MCP server + REST, bilingual | Prices only - no cross-script comparison |
| [@aiqtech token visualisation](https://huggingface.co/posts/aiqtech/339494015180136) | Multilingual token visualisation | A visualiser, not a quotable measurement |
| [`tokenx`](https://github.com/johannschopplich/tokenx) | Fast token estimation, 2 kB bundle | Estimates; does not explain the gap |
| Tokenizer playgrounds (OpenAI / HF) | Try one string on one tokenizer | No cross-script, no attribution |
| [arXiv 2609.39001](https://browse-export.arxiv.org/pdf/2609.39001) | The **same idea for another language**: token premiums of French and regional languages (2026) | A research paper, not a tool |

What follows for positioning:

1. The **combination** - cross-script comparison + attribution + a reproducible benchmark - was not
   found in any tool.
2. The **finding is not novel**: there is academic work and Chinese media coverage of the "Chinese
   tax". Sell the quotable measurement and the working tool; never "we discovered this".
3. **Real risk**: a project like `ohmytoken` could bolt on a Chinese comparison in days. The moat is
   the benchmark table and the discipline of maintaining it, not the code.
4. Say this in the launch post: *we do not compare prices (they change); we compare scripts and
   explain where the extra tokens come from* - otherwise it reads as yet another counter.

## Candidate channels (unranked, to validate)

| Channel | What to post | Notes |
|---|---|---|
| MCP server directories | Short listing: 3 tools, one install line | Generic counters already listed there; the cross-script angle is the differentiator |
| awesome-mcp-servers style lists | PR adding one line | Check each list's contribution rules first |
| Chinese-language dev communities | The matrix as a standalone post, tool second | e.g. 掘金 / V2EX / 小报童-style; HK-focused groups too |
| Reddit / HN | "Chinese costs more tokens than English - here is the measured matrix" | Numbers-first titles only; the tool is the footnote |
| HK dev / AI meetups | 5-minute demo on one's own prompt | Local credibility is a real advantage here |

## Rules

- Do not claim demand that has not been measured. This project's own selling point is that it
  reports real numbers - so should its promotion.
- Every post quotes `BENCHMARK.md`, with the tokenizer named. No rounded-up claims.
- Track results here (date, channel, response) so the go/no-go in the feasibility report can be
  evaluated honestly rather than by memory.
