require('dotenv').config();

const { Client, GatewayIntentBits, Intents } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, EndBehaviorType } = require('@discordjs/voice');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const prism = require('prism-media');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const TOKEN = process.env.DISCORD_TOKEN;
const botnames = process.env.BOT_TRIGGERS.split(',');
if (!Array.isArray(botnames)) {
  console.error('BOT_TRIGGERS must be an array of strings');
  process.exit(1);
}
console.log('Bot Triggers:', botnames);
let chatHistory = {};

let allowwithouttrigger = false;

// Create the directories if they don't exist
if (!fs.existsSync('./recordings')) {
  fs.mkdirSync('./recordings');
}
if (!fs.existsSync('./sounds')) {
  fs.mkdirSync('./sounds');
}

client.on('ready', () => {
  // Clean up any old recordings
  fs.readdir('./recordings', (err, files) => {
    if (err) {
      console.error('Error reading recordings directory:', err);
      return;
    }

    files.forEach(file => {
      fs.unlinkSync(`./recordings/${file}`);
    });
  });

  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
  if (message.content === '>join') {
    allowwithouttrigger = false;
    if (message.member.voice.channel) {
      // Delete user's message for spam
      message.delete();

      const connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false,
      });
      handleRecording(connection, message.member.voice.channel);
    } else {
      message.reply('You need to join a voice channel first!');
    }
  }
  if (message.content === '>join free') {
    allowwithouttrigger = true;
    if (message.member.voice.channel) {
      // Delete user's message for spam
      message.delete();

      const connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false,
      });
      handleRecording(connection, message.member.voice.channel);
    } else {
      message.reply('You need to join a voice channel first!');
    }
  }
  if (message.content === '>reset') {
    chatHistory = {};
    message.reply('Chat history reset!');
  }
});

function handleRecording(connection, channel) {
  const receiver = connection.receiver;
  channel.members.forEach(member => {
    if (member.user.bot) return;

    const filePath = `./recordings/${member.user.id}_${Date.now()}.pcm`;
    const writeStream = fs.createWriteStream(filePath);
    const listenStream = receiver.subscribe(member.user.id, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 2000,
      },
    });

    const opusDecoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 1,
      rate: 48000,
    });

    listenStream.pipe(opusDecoder).pipe(writeStream);

    writeStream.on('finish', () => {
      console.log(`Audio recorded for ${member.user.username}`);
      convertAndHandleFile(filePath, member.user.id, connection, channel);
    });
  });
}

function convertAndHandleFile(filePath, userid, connection, channel) {
  const mp3Path = filePath.replace('.pcm', '.mp3');
  ffmpeg(filePath)
  .inputFormat('s16le')
  .audioChannels(1)
  .audioFrequency(48000)
  .format('mp3')
  .on('error', (err) => {
    console.error(`Error converting file: ${err.message}`);
  })
  .save(mp3Path)
  .on('end', () => {
    console.log(`Converted to MP3: ${mp3Path}`);
    sendAudioToAPI(mp3Path, userid, connection, channel);
  });
}

async function sendAudioToAPI(fileName, userId, connection, channel) {
  const formData = new FormData();
  formData.append('model', process.env.STT_MODEL);
  formData.append('file', fs.createReadStream(fileName));

  try {
    const response = await axios.post(process.env.STT_ENDPOINT + '/v1/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });
    const transcription = response.data.text;
    console.log(`Transcription for ${userId}: "${transcription}"`);

    // Check if transcription is a command
    if (transcription.includes("reset") && transcription.includes("chat") && transcription.includes("history")) {
      playSound(connection, 'command');
      chatHistory = {};
      console.log('Chat history reset!');
      restartListening(connection, channel);
      return;
    }
    else if (transcription.includes("leave") && transcription.includes("voice") && transcription.includes("chat")) {
      playSound(connection, 'command');
      connection.destroy();
      chatHistory = {};
      console.log('Left voice channel');
      return;
    }

    // Check if the transcription includes the bot's name
    if (botnames.some(name => {
      const regex = new RegExp(`\\b${name}\\b`, 'i');
      return regex.test(transcription) || allowwithouttrigger;
    })) {
        playSound(connection, 'understood');
        sendToLLM(transcription, userId, connection, channel);
    } else {
        console.log("Bot was not addressed directly. Ignoring the command.");
        restartListening(connection, channel);
    }
  } catch (error) {
    console.error('Failed to transcribe audio:', error);
  } finally {
    // Ensure files are always deleted regardless of the transcription result
    try {
      fs.unlinkSync(fileName);
      const pcmPath = fileName.replace('.mp3', '.pcm');  // Ensure we have the correct .pcm path
      fs.unlinkSync(pcmPath);
    } catch (cleanupError) {
      console.error('Error cleaning up files:', cleanupError.message);
    }
  }
}

async function sendToLLM(transcription, userId, connection, channel) {
  let messages = chatHistory[userId] || [];

  // If this is the first message, add a system prompt
  if (messages.length === 0) {
    messages.push({
      role: 'system',
      content: process.env.LLM_SYSTEM_PROMPT
    });
  }
  
  // Add the user's message to the chat history
  messages.push({
    role: 'user',
    content: transcription
  });

  // Keep only the latest X messages
  const messageCount = messages.length;
  if (messageCount > process.env.MEMORY_SIZE) {
    messages = messages.slice(messageCount - process.env.MEMORY_SIZE);
  }

  try {
    const response = await axios.post(process.env.LLM_ENDPOINT+'/api/chat', {
      model: process.env.LLM,
      messages: messages,
      stream: false
    });

    const { message } = response.data;
    console.log('LLM Response:', message.content);

    // Store the LLM's response in the history
    messages.push({
      role: 'assistant',
      content: message.content
    });
    
    // Update the chat history
    chatHistory[userId] = messages;

    // Send response to TTS service
    playSound(connection, 'result');
    sendToTTS(message.content, connection, channel);
  } catch (error) {
    console.error('Failed to communicate with LLM:', error);
  }
}

async function sendToTTS(text, connection, channel) {
  try {
    const response = await axios.post(process.env.TTS_ENDPOINT+'/v1/audio/speech', {
      model: process.env.TTS_MODEL,
      input: text,
      voice: process.env.TTS_VOICE,
      response_format: "mp3",
      speed: 1.0
    }, {
      responseType: 'arraybuffer'
    });

    const audioBuffer = Buffer.from(response.data);

    // save the audio buffer to a file
    fs.writeFileSync('./sounds/tts.mp3', audioBuffer);

    // Create an audio player
    const player = createAudioPlayer();

    // Create an audio resource from a local file
    const resource = createAudioResource('./sounds/tts.mp3');

    // Subscribe the connection to the player and play the resource
    connection.subscribe(player);
    player.play(resource);

    // Handle clean up and restart listening
    player.on(AudioPlayerStatus.Idle, () => {
      console.log('Finished speaking, ready to listen again.');
      restartListening(connection, channel);
    });
    player.on('error', error => console.error(`Error: ${error.message}`));

  } catch (error) {
    console.error('Failed to send text to TTS:', error);
  }
}

async function playSound(connection, sound) {
  // Check if the sound file exists
  if (!fs.existsSync(`./sounds/${sound}.mp3`)) {
    console.error(`Sound file not found: ${sound}.mp3`);
    return;
  }

  // Create an audio player
  const player = createAudioPlayer();

  // Create an audio resource from a local file
  const resource = createAudioResource('./sounds/'+sound+'.mp3');

  // Subscribe the connection to the player and play the resource
  connection.subscribe(player);
  player.play(resource);

  player.on('error', error => console.error(`Error: ${error.message}`));
}

function restartListening(connection, channel) {
  // Implement your listening logic here. This could be a call to handleRecording or similar.
  handleRecording(connection, channel);
}

client.login(TOKEN);