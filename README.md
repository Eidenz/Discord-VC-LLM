# Discord Voice Chat LLM

This Discord bot uses voice recognition to interact with users in a voice channel through transcription, processing with a Large Language Model (LLM), and responding with synthesized voice. The bot converts spoken audio to text, sends it to an LLM for processing, and uses Text-to-Speech (TTS) to voice the response.

## Features
- __Conversation:__ Engage in a conversation with the bot using voice input.
- __Music Playback:__ Play music from YouTube in the voice channel. Say `play [query] on youtube` or `play [query] song` to play a song. You can also use the `>play` command.
- __Timers:__ Set a timer by saying `set a timer for [time]` or `set an alarm for [time]`. The bot will notify you when the timer is up.
- __Internet search:__ Ask the bot to search the internet for you by saying `search [query] on internet` or `search on internet for [query]`. The bot will respond using the web.
- __Vision:__ Send an image mentioning the bot, and it will react to it in voice chat.

## Prerequisites

- Node.js and npm installed
- A Discord Bot Token
- Access to OpenAI compatible APIs for STT (Speech to Text), LLM, and TTS services (for fully local, checkout `openedai-whisper`, `ollama` and `openedai-speech`)
- If you wish to use timer and alarms, you need a `alarm.mp3` and `timer.mp3` files in the `sounds` folder.

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
- Use the invite link generated through your Discord application page. Here is a quick link with all the permissions the bot should ever need:
https://discord.com/oauth2/authorize?client_id=REPLACEME&permissions=964220516416&scope=bot

(Change "REPLACEME" with your bot's ID)

3. **Using the Bot in Discord:**
- Ensure the bot has permission to join voice channels and speak.
- In a Discord server where the bot is a member, join a voice channel and type the command `>join` or `>join free`.
- The bot will join the channel and start listening to users who are speaking. Spoken phrases are processed and responded to in real-time.

## Commands
- `>join`: Command for the bot to join the voice channel you are currently in. The bot will listen to voice input, transcribe it, send it to the LLM if you used a trigger word, and respond with a spoken answer using TTS.
- `>join free`: Similar to `>join`, but will respond to everything without using trigger words. Best for solo usage.
- `>join silent`: Similar to `>join`, but no confirmation sound will play when trigger is detected/llm responded.
- `>join transcribe`: Similar to `>join`, but will save the transcriptions to a file and send it once you use the `>leave` command.
- `>play [song name or URL]`: Play a song from YouTube using either its name (search via API) or direct URL. Please note that the search function requires a valid API key. You may also say `play [query] on youtube` or `play [query] song` in voice chat.
- `>reset`: Reset the LLM chat history. You may also say `reset chat history` in voice chat.
- `>leave`: Command for the bot to leave the voice channel. You may also say `leave voice chat` in voice chat.
- `>help`: Display the list of available commands.

__You may at any time say `stop` to stop the bot while it is speaking.__

## Troubleshooting
- **Bot Doesn't Join Channel**: Ensure the bot has the correct permissions in your Discord server, including the ability to join and speak in voice channels.
- **No Audio from Bot**: Check that the TTS API is returning valid MP3 audio data and that the bot has permissions to play audio in the channel.
- **Errors in Transcription or Response**: Verify that the API endpoints and models specified in the `.env` file are correct and that the APIs are operational.
