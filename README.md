# Discord Voice Chat LLM

This Discord bot uses voice recognition to interact with users in a voice channel through transcription, processing with a Large Language Model (LLM), and responding with synthesized voice. The bot converts spoken audio to text, sends it to an LLM for processing, and uses Text-to-Speech (TTS) to voice the response.

## Prerequisites

- Node.js and npm installed
- A Discord Bot Token
- Access to OpenAI compatible APIs for STT (Speech to Text), LLM, and TTS services (for fully local, checkout `openedai-whisper`, `ollama` and `openedai-speech`)

## Installation

1. **Clone the Repository:**
   ```bash
   git clone <repository-url>
   cd <repository-directory>
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Configure the Environment:**
- Rename `.env.example` to `.env`.
- Update the `.env` file with your specific credentials and API endpoints.

## Usage
1. **Start the Bot:**
   ```bash
   node bot.js
   ```

2. **Invite the Bot to Your Discord Server:**
- Use the invite link generated through your Discord application page.

3. **Using the Bot in Discord:**
- Ensure the bot has permission to join voice channels and speak.
- In a Discord server where the bot is a member, join a voice channel and type the command `>join` or `>join free`.
- The bot will join the channel and start listening to users who are speaking. Spoken phrases are processed and responded to in real-time.

## Commands
- `>join`: Command for the bot to join the voice channel you are currently in. The bot will listen to voice input, transcribe it, send it to the LLM if you used a trigger word, and respond with a spoken answer using TTS.
- `>join free`: Similar to `>join`, but will respond to everything without using trigger words. Best for solo usage.

## Features
- **Real-time Voice Recognition**: Transcribes user speech in real-time.
- **Integration with LLM**: Processes transcriptions through a custom LLM to generate responses.
- **Voice Responses**: Uses TTS to convert text responses into speech, playing them back into the voice channel.

## Troubleshooting
- **Bot Doesn't Join Channel**: Ensure the bot has the correct permissions in your Discord server, including the ability to join and speak in voice channels.
- **No Audio from Bot**: Check that the TTS API is returning valid MP3 audio data and that the bot has permissions to play audio in the channel.
- **Errors in Transcription or Response**: Verify that the API endpoints and models specified in the `.env` file are correct and that the APIs are operational.