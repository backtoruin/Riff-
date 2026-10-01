# RiffMaster — PRD

## Overview
RiffMaster is a gamified, mobile-first AI guitar teacher app. The AI teacher "Riff" chats with the student, sees their playing via camera, listens via microphone (pitch detection), and reads MIDI note events — then gives specific, human-sounding feedback like a real teacher.

## Tech Stack
- **Frontend**: Expo React Native (SDK 57) with Expo Router, TypeScript, React Query, Reanimated, Keyboard Controller, Lucide icons, SVG for avatar.
- **Backend**: FastAPI + Motor (MongoDB), emergentintegrations library.
- **AI**: Gemini 3 Flash (vision-capable) via Emergent LLM key.
- **TTS**: Emergent-managed OpenAI TTS (`tts-1` voice `onyx`).
- **Auth**: Emergent-managed Google OAuth (7-day session tokens, bearer-auth).

## Design System
- Dark-only theme (`#121212` surface) with Signal Orange brand (`#FF6B00`).
- Tactile/playful gamified components (Duolingo meets Fender Play).
- Phosphor-style icons via `lucide-react-native`.
- All colors come from `src/theme.ts`; design tokens from `/app/design_guidelines.json`.

## Features Shipped (MVP)
1. **Auth** — Google sign-in; session persists across launches.
2. **Home dashboard** — Sticky header with streak flame + XP bar + user avatar, "Ask Riff" hero CTA, stats cards (Total XP, Badges, Lessons Done), next-up lesson card.
3. **Studio (live practice)** — Riff chat with vision analysis:
   - Camera toggle (expo-camera, front-facing) with "ANALYZE MY TECHNIQUE" button that captures a frame, resizes it, and sends to Gemini for critique.
   - Microphone toggle starts in-browser pitch detection (Web Audio API autocorrelation) with a live tuner and loudness meter. On native, graceful no-op; still useful for text chat context.
   - Web MIDI support (navigator.requestMIDIAccess) that shows recent note names from a connected MIDI device.
   - Text chat with Riff (persists in MongoDB).
   - "HEAR RIFF SAY IT" button on each Riff reply plays OpenAI TTS audio.
4. **Lessons library** — 8 seeded lessons across Fundamentals, Chords, Rhythm, Scales, Technique, Theory. Filter chips (All/Beginner/Intermediate/Advanced). Difficulty badges + XP + duration.
5. **Lesson detail** — Hero image, meta pills, body content, "Mark as complete" (or Replay) with XP/streak/badge rewards.
6. **Gamification** — XP, levels (300 XP base + 150 per level), streaks (daily increment, reset on gap), 7 achievement badges auto-earned (First Note, Chord Warrior, 3-day & 7-day streak, 500 XP, 1,500 XP, Studio Rat).
7. **Profile** — Avatar + stats grid (XP, Streak, Lessons, Sessions) + full badge grid (earned vs locked) + Sign Out.

## Data Model (MongoDB collections)
- `users` { user_id, email, name, picture, created_at, last_login }
- `user_sessions` { session_token, user_id, created_at, expires_at (TTL) }
- `lessons` { lesson_id, order, title, subtitle, difficulty, xp, duration_min, category, image_url, content }
- `progress` { user_id, xp, streak_days, last_practice_date, completed_lessons[], sessions_count, badges[] }
- `chat_messages` { id, user_id, role, text, has_image, context, created_at }

## API Endpoints
- `POST /api/auth/session` — exchange `session_id` → `session_token`
- `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/lessons`, `GET /api/lessons/{id}`
- `GET /api/me/progress`, `POST /api/me/complete-lesson`, `POST /api/me/log-session`
- `POST /api/chat/message` (optional base64 image for vision), `GET /api/chat/history`
- `POST /api/tts`, `GET /api/tts/{key}.mp3`

## Known limitations
- Live audio pitch detection only works on **web** (Web Audio API). On native, mic toggle is a no-op; the text chat still works. Can be upgraded later with a native audio-tap library.
- Web MIDI is **web-only**. Native Expo Go cannot access MIDI; a native build with a MIDI module would be required.
- OAuth exchange requires the real Emergent redirect; cannot be mocked locally.
- Camera analysis sends base64 JPEG (resized to 720px wide) directly to the backend; stored only transiently via LLM request.

## Backend testing: 24/24 passed — see `/app/test_reports/iteration_1.json`.
