# Ice Cream Social Fandom App - Claude Project

## Project Overview

Building an AI-powered companion app for the "Matt and Mattingly's Ice Cream Social" podcast that automatically transcribes, analyzes, and catalogs content to create a searchable fandom wiki.

---

## Project Goals

1. **Transcribe & Index** - Process 500+ episodes of back catalog plus ongoing new episodes
2. **Speaker Attribution** - Identify who said what (Matt Donnelly, Paul Mattingly, guests)
3. **Content Extraction** - Automatically identify characters, bits, recurring segments, and trivia
4. **Semantic Search** - Enable natural language queries like "find the bit about..."
5. **Fandom Wiki** - Generate per-episode pages with structured data
6. **Social Aggregation** - Pull in @heyscoops social media content
7. **Community Features** - Re-analysis requests, user contributions

---

## Technical Stack (Planned)

### Transcription Pipeline
- **Primary**: Faster-Whisper (local, free, fast)
- **Alternative**: AssemblyAI (cloud, has speaker diarization built-in)
- **Speaker Diarization**: Pyannote.audio (if using local transcription)

### RAG & Search
- **Option A**: AnythingLLM (quick setup, good for MVP)
- **Option B**: Custom stack with LangChain + vector database

### Storage
- **Transcripts**: Markdown files or PostgreSQL
- **Vector Search**: LanceDB (with AnythingLLM) or Pinecone/pgvector
- **Structured Data**: PostgreSQL or SQLite

### Frontend (Future)
- Next.js or similar for wiki pages
- React for interactive components

---

## Key Entities to Track

### Episodes
- Episode number
- Title
- Air date
- Duration
- RSS/podcast links
- Full transcript
- Timestamps for segments

### Characters (Recurring Bits)
- Character name
- First appearance (episode + timestamp)
- All appearances
- Description/traits
- Voice/performer
- Notable quotes

### Guests
- Name
- Episodes appeared
- Profession/context
- Links (social, website)

### Trivia (Jock vs Nerd)
- Episode
- Category
- Questions asked
- Answers
- Winner (Jock or Nerd)
- Running score/stats

### Recurring Segments
- Segment name (e.g., "Jock vs Nerd", "Would You Rather", etc.)
- Episodes containing segment
- Typical timestamp/placement

### Notable Mentions
- Domains they joked about buying
- Products/services mentioned
- Callbacks to previous episodes
- Inside jokes origin points

---

## Development Phases

### Phase 1: Proof of Concept (Target: 2 weeks)
- [ ] Set up Faster-Whisper locally
- [ ] Transcribe 10 test episodes
- [ ] Upload to AnythingLLM
- [ ] Test semantic search queries
- [ ] Validate quality and usefulness

### Phase 2: Automated Pipeline (Target: 2-4 weeks)
- [ ] Build RSS feed monitor
- [ ] Automate download → transcribe → upload flow
- [ ] Add speaker diarization
- [ ] Process full back catalog (batched)

### Phase 3: Structured Extraction (Target: 1-2 months)
- [ ] Design database schema
- [ ] Build LLM extraction prompts for characters, trivia, etc.
- [ ] Create episode analysis pipeline
- [ ] Generate structured data from transcripts

### Phase 4: Frontend & Community (Target: 2+ months)
- [ ] Build episode wiki pages
- [ ] Add search interface
- [ ] Social media aggregation
- [ ] User accounts and contributions
- [ ] Re-analysis request system

---

## Resources & Links

### Podcast
- RSS Feed: [Find on podcast app or website]
- Website: https://www.icecreampodcast.com/
- Patreon: [If applicable]
- Social: @heyscoops on Twitter/X

### Technical Documentation
- [Faster-Whisper GitHub](https://github.com/SYSTRAN/faster-whisper)
- [Pyannote.audio](https://github.com/pyannote/pyannote-audio)
- [AnythingLLM Docs](https://docs.useanything.com/)
- [AssemblyAI Docs](https://www.assemblyai.com/docs)

### Development Environment
- Machine: MacBook Air M4 (24GB RAM)
- Python version: 3.11+
- Key packages: faster-whisper, pyannote.audio, requests, feedparser

---

## Questions to Resolve

1. **Legal/Permission**: Should we reach out to Matt & Paul for blessing?
2. **Scope**: Start with recent episodes or go back to episode 1?
3. **Speaker diarization**: Worth the complexity for MVP or add later?
4. **Hosting**: Self-hosted vs cloud for final product?
5. **Community**: Open source? Invite other Scoops to contribute?

---

## Session Log

Use this section to track progress across Claude conversations:

### Session 1 - [Date]
- Initial project planning and feasibility analysis
- Decided on Faster-Whisper + AnythingLLM approach
- Created project structure

*(Add new sessions as you work on this)*

---
