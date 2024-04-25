require('dotenv').config();

const { Client, GatewayIntentBits, Intents } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const TOKEN = process.env.DISCORD_TOKEN;
const chatHistory = {};
const audioPlayers = {};

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
  if (message.content === '>join') {
    if (message.member.voice.channel) {
      const connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      console.log('Joined voice channel!');
      listenToUserAudio(connection, message.member);
    } else {
      message.reply('You need to join a voice channel first!');
    }
  }
});

function listenToUserAudio(connection, member) {
  const receiver = connection.receiver;
  connection.on('speaking', (user, speaking) => {
    if (speaking) {
      console.log(`I'm listening to ${user.username}`);
      const audioStream = receiver.subscribe(user.id, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 100,
        },
      });

      const audioFileName = `./recordings/${user.id}-${Date.now()}.pcm`;
      const writeStream = fs.createWriteStream(audioFileName);
      audioStream.pipe(writeStream);

      writeStream.on('finish', () => {
        console.log(`Audio recorded for ${user.username}`);
        sendAudioToAPI(audioFileName, user.id, connection);
      });
    }
  });
}

async function sendAudioToAPI(fileName, userId, connection) {
  const formData = new FormData();
  formData.append('model', process.env.STT_MODEL);
  formData.append('file', fs.createReadStream(fileName));

  try {
    const response = await axios.post(process.env.STT_ENDPOINT+'/v1/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });
    const transcription = response.data.text;
    sendToLLM(transcription, userId, connection);
  } catch (error) {
    console.error('Failed to transcribe audio:', error);
  }
}

async function sendToLLM(transcription, userId, connection) {
  const messages = chatHistory[userId] || [];
  messages.push({
    role: 'user',
    content: transcription
  });

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
    chatHistory[userId] = messages;

    // Send response to TTS service
    sendToTTS(message.content, connection);
  } catch (error) {
    console.error('Failed to communicate with LLM:', error);
  }
}

async function sendToTTS(text, connection) {
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
    const player = createAudioPlayer();
    const resource = createAudioResource(audioBuffer, { inputType: StreamType.Arbitrary });
    
    if (!audioPlayers[connection.guildId]) {
      audioPlayers[connection.guildId] = player;
      connection.subscribe(player);
    }

    audioPlayers[connection.guildId].play(resource);
    console.log('Playing response in voice channel.');
  } catch (error) {
    console.error('Failed to send text to TTS:', error);
  }
}

client.login(TOKEN);