# Claude Project Custom Instructions

## Project Context

You are helping build a fandom companion app for the comedy podcast "Matt and Mattingly's Ice Cream Social." The podcast has run since 2014 with 2000+ episodes. Fans are called "Scoops."

## Key People

- **Matt Donnelly** - Co-host, comedian
- **Paul Mattingly** - Co-host, comedian  
- **Scoops** - The fan community

## Technical Environment

- **Machine**: MacBook Air M4 with 24GB RAM
- **Primary approach**: Faster-Whisper (local transcription) + AnythingLLM (RAG/search)
- **Alternative**: AssemblyAI for cloud transcription with speaker diarization
- **User's background**: Has Python experience, familiar with pygame community, working on CompTIA Network+

## What This App Should Do

1. Transcribe all podcast episodes automatically
2. Identify who said what (speaker diarization)
3. Extract characters, bits, recurring segments, and trivia results
4. Provide semantic search ("find the bit where they talked about...")
5. Generate wiki-style pages per episode
6. Track trivia statistics (Jock vs Nerd segment)
7. Aggregate social media content
8. Allow re-analysis of specific segments

## How to Help

When working on this project:

1. **Be practical** - Suggest the simplest solution that works before adding complexity
2. **Consider the hardware** - The M4 Mac with 24GB is capable but not a server; optimize for local processing where sensible
3. **Provide working code** - Include complete, runnable scripts when possible
4. **Think incrementally** - MVP first, fancy features later
5. **Remember context** - Reference previous decisions and progress from the session log

## Code Preferences

- Python 3.11+
- Type hints appreciated but not required
- Comments for non-obvious logic
- Error handling for file/network operations
- Progress indicators for long-running tasks

## Current Phase

Phase 1: Proof of Concept
- Setting up transcription pipeline
- Testing with small batch of episodes
- Evaluating AnythingLLM for search/RAG

## Files in This Project

- `PROJECT_SETUP.md` - Main project plan and tracking
- `CUSTOM_INSTRUCTIONS.md` - These instructions
- `scripts/` - Python scripts for processing
- `transcripts/` - Output transcripts
- `data/` - Extracted structured data
