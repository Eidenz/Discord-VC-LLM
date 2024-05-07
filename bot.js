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
  logToConsole('BOT_TRIGGERS must be an array of strings', 'error', 1);
  process.exit(1);
}
logToConsole('Bot Triggers: ' + botnames, 'info', 1);
let chatHistory = {};

let allowwithouttrigger = false;
let currentlythinking = false;

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
      logToConsole('Error reading recordings directory', 'error', 1);
      return;
    }

    files.forEach(file => {
      fs.unlinkSync(`./recordings/${file}`);
    });
  });

  logToConsole(`Logged in as ${client.user.tag}!`, 'info', 1);
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
    message.reply('> Chat history reset!');
  }
});

function handleRecording(connection, channel) {
  const receiver = connection.receiver;
  channel.members.forEach(member => {
    if (member.user.bot) return;

    const filePath = `./recordings/${member.user.id}.pcm`;
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
      logToConsole(`> Audio recorded for ${member.user.username}`, 'info', 2);
      convertAndHandleFile(filePath, member.user.id, connection, channel);
    });
  });
}

function handleRecordingForUser(userID, connection, channel) {
  const receiver = connection.receiver;

  const filePath = `./recordings/${userID}.pcm`;
  const writeStream = fs.createWriteStream(filePath);
  const listenStream = receiver.subscribe(userID, {
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
    logToConsole(`> Audio recorded for ${userID}`, 'info', 2);
    convertAndHandleFile(filePath, userID, connection, channel);
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
    logToConsole(`X Error converting file: ${err.message}`, 'error', 1);
    currentlythinking = false;
  })
  .save(mp3Path)
  .on('end', () => {
    logToConsole(`> Converted to MP3: ${mp3Path}`, 'info', 2);
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
    let transcription = response.data.text;
    logToConsole(`> Transcription for ${userId}: "${transcription}"`, 'info', 1);

    if(currentlythinking){
      if (transcription.includes("stop")) {
        playSound(connection, 'command');
        currentlythinking = false;
        audioqueue = [];
        logToConsole('> Bot stopped thinking.', 'info', 1);
        restartListening(userId, connection, channel);
        return;
      }

      logToConsole('> Bot is already thinking, ignoring transcription.', 'info', 2);
      restartListening(userId, connection, channel);
      return;
    }

    // Check if transcription is a command
    if (transcription.includes("reset") && transcription.includes("chat") && transcription.includes("history")) {
      playSound(connection, 'command');
      currentlythinking = false;
      chatHistory = {};
      logToConsole('> Chat history reset!', 'info', 1);
      restartListening(userId, connection, channel);
      return;
    }
    else if (transcription.includes("leave") && transcription.includes("voice") && transcription.includes("chat")) {
      playSound(connection, 'command');
      currentlythinking = false;
      connection.destroy();
      chatHistory = {};
      logToConsole('> Left voice channel', 'info', 1);
      return;
    }

    // Check if the transcription includes the bot's name
    if (botnames.some(name => {
      const regex = new RegExp(`\\b${name}\\b`, 'i');
      return regex.test(transcription) || allowwithouttrigger;
    })) {
        // Ignore if the string is a single word
        if (transcription.split(' ').length <= 1) {
          currentlythinking = false;
          logToConsole('> Ignoring single word command.', 'info', 2);
          restartListening(userId, connection, channel);
          return;
        }

        // Remove the first occurrence of the bot's name from the transcription
        transcription = transcription.replace(new RegExp(`\\b${botnames[0]}\\b`, 'i'), '').trim();
        currentlythinking = true;
        playSound(connection, 'understood');
        sendToLLM(transcription, userId, connection, channel);
        restartListening(userId, connection, channel);
    } else {
        currentlythinking = false;
        logToConsole('> Bot was not addressed directly. Ignoring the command.', 'info', 2);
        restartListening(userId, connection, channel);
    }
  } catch (error) {
    currentlythinking = false;
    logToConsole(`X Failed to transcribe audio: ${error.message}`, 'error', 1);
    // Restart listening after an error
    restartListening(userId, connection, channel);
  } finally {
    // Ensure files are always deleted regardless of the transcription result
    try {
      fs.unlinkSync(fileName);
      const pcmPath = fileName.replace('.mp3', '.pcm');  // Ensure we have the correct .pcm path
      fs.unlinkSync(pcmPath);
    } catch (cleanupError) {
      logToConsole(`X Error cleaning up files: ${cleanupError.message}`, 'error', 1);
    }
  }
}

async function sendToLLM(transcription, userId, connection, channel) {
  let messages = chatHistory[userId] || [];

  // If this is the first message, add a system prompt
  if (messages.length === 0) {
    if(allowwithouttrigger){
      messages.push({
        role: 'system',
        content: process.env.LLM_SYSTEM_PROMPT_FREE
      });
    }
    else{
      messages.push({
        role: 'system',
        content: process.env.LLM_SYSTEM_PROMPT
      });
    }
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
    const client = axios.create({
      baseURL: process.env.LLM_ENDPOINT,
      headers: {
        'Authorization': `Bearer ${process.env.LLM_API}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Chat completion without streaming
    client.post('/chat/completions', {
      model: process.env.LLM,
      messages: messages,
    })
    .then((response) => {
      const { message } = response.data;
      logToConsole(`> LLM Response: ${message.content}`, 'info', 1);

      if(message.content.includes("IGNORING")){
        currentlythinking = false;
        logToConsole('> LLM Ignored the command.', 'info', 2);
        return;
      }

      // Store the LLM's response in the history
      messages.push({
        role: 'assistant',
        content: message.content
      });
      
      // Update the chat history
      chatHistory[userId] = messages;

      // Send response to TTS service
      playSound(connection, 'result');
      sendToTTS(message.content, userId, connection, channel);
    })
    .catch((error) => {
      currentlythinking = false;
      logToConsole(`X Failed to communicate with LLM: ${error.message}`, 'error', 1);
    });
  } catch (error) {
    currentlythinking = false;
    logToConsole(`X Failed to communicate with LLM: ${error.message}`, 'error', 1);
  }
}

let audioqueue = [];

async function sendToTTS(text, userid, connection, channel) {
  const words = text.split(' ');
  const maxChunkSize = 60; // Maximum words per chunk
  const punctuationMarks = ['.', '!', '?', ';', ':']; // Punctuation marks to look for
  const chunks = [];

  for (let i = 0; i < words.length;) {
    let end = Math.min(i + maxChunkSize, words.length); // Find the initial end of the chunk

    // If the initial end is not the end of the text, try to find a closer punctuation mark
    if (end < words.length) {
      let lastPunctIndex = -1;
      for (let j = i; j < end; j++) {
        if (punctuationMarks.includes(words[j].slice(-1))) {
          lastPunctIndex = j;
        }
      }
      // If a punctuation mark was found, adjust the end to be after it
      if (lastPunctIndex !== -1) {
        end = lastPunctIndex + 1;
      }
    }

    // Create the chunk from i to the new end, then adjust i to start the next chunk
    chunks.push(words.slice(i, end).join(' '));
    i = end;
  }

  for (const chunk of chunks) {
    try {
      if(process.env.TTS_TYPE === "speecht5"){
        logToConsole('> Using SpeechT5 TTS', 'info', 2);
        const response = await axios.post(process.env.TTS_ENDPOINT + '/synthesize', {
          text: chunk,
        }, {
          responseType: 'arraybuffer'
        });

        const audioBuffer = Buffer.from(response.data);

        // save the audio buffer to a file
        const filename = `./sounds/tts_${chunks.indexOf(chunk)}.wav`;
        fs.writeFileSync(filename, audioBuffer);

        if(process.env.RVC === "true"){
          sendToRVC(filename, userid, connection, channel);
        }
        else{
          audioqueue.push({ file: filename, index: chunks.indexOf(chunk) });

          if (audioqueue.length === 1) {
            playAudioQueue(connection, channel, userid);
          }
        }
      }
      else{
        logToConsole('> Using OpenAI TTS', 'info', 2);

        const response = await axios.post(process.env.OPENAI_TTS_ENDPOINT + '/v1/audio/speech', {
          model: process.env.TTS_MODEL,
          input: chunk,
          voice: process.env.TTS_VOICE,
          response_format: "mp3",
          speed: 1.0
        }, {
          responseType: 'arraybuffer'
        });

        const audioBuffer = Buffer.from(response.data);

        // save the audio buffer to a file
        const filename = `./sounds/tts_${chunks.indexOf(chunk)}.mp3`;
        fs.writeFileSync(filename, audioBuffer);

        if(process.env.RVC === "true"){
          sendToRVC(filename, userid, connection, channel);
        }
        else{
          audioqueue.push({ file: filename, index: chunks.indexOf(chunk) });

          if (audioqueue.length === 1) {
            logToConsole('> Playing audio queue', 'info', 2);
            playAudioQueue(connection, channel, userid);
          }
        }
      }
    } catch (error) {
      currentlythinking = false;
      logToConsole(`X Failed to send text to TTS: ${error.message}`, 'error', 1);
    }
  }
}

async function sendToRVC(file, userid, connection, channel) {
  try {
    logToConsole('> Sending TTS to RVC', 'info', 2);

    let mp3name = file.replace('tts', 'rvc');
    mp3name = mp3name.replace('mp3', 'wav');
    let mp3index = mp3name.split('_')[1].split('.')[0];
    mp3index = parseInt(mp3index);

    // Create an instance of FormData
    const formData = new FormData();

    // Append the file to the form data. Here 'input_file' is the key name used in the form
    formData.append('input_file', fs.createReadStream(file), {
      filename: file,
      contentType: 'audio/mpeg'
    });

    // Configure the Axios request
    const config = {
      method: 'post',
      url: process.env.RVC_ENDPOINT+'/voice2voice?model_name='+process.env.RVC_MODEL+'&index_path='+process.env.RVC_MODEL+'&f0up_key='+process.env.RVC_F0+'&f0method=rmvpe&index_rate='+process.env.RVC_INDEX_RATE+'&is_half=false&filter_radius=3&resample_sr=0&rms_mix_rate=1&protect='+process.env.RVC_PROTECT,
      headers: { 
        ...formData.getHeaders(), // Spread the headers from formData to ensure correct boundary is set
        'accept': 'application/json'
      },
      responseType: 'stream', // This ensures that Axios handles the response as a stream
      data: formData
    };

    // Send the request using Axios
    axios(config)
    .then(function (response) {
      // Handle the stream response to save it as a file
      const writer = fs.createWriteStream(mp3name);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    })
    .then(() => {
      // Delete original tts file
      fs.unlinkSync(file);

      audioqueue.push({ file: mp3name, index: mp3index });

      if (audioqueue.length === 1) {
        logToConsole('> Playing audio queue', 'info', 2);
        playAudioQueue(connection, channel, userid);
      }
    })
    .catch(function (error) {
      logToConsole(`X Failed to send tts to RVC: ${error.message}`, 'error', 1);
    });
  } catch (error) {
    currentlythinking = false;
    logToConsole(`X Failed to send tts to RVC: ${error.message}`, 'error', 1);
  }
}

let currentIndex = 0;
let retryCount = 0;
const maxRetries = 5; // Maximum number of retries before giving up

async function playAudioQueue(connection, channel, userid) {
  // Sort the audioqueue based on the index to ensure the correct play order
  audioqueue.sort((a, b) => a.index - b.index);

  while (audioqueue.length > 0) {
    const audio = audioqueue.find(a => a.index === currentIndex);
    if (audio) {
      // Create an audio player
      const player = createAudioPlayer();
      
      // Create an audio resource from a local file
      const resource = createAudioResource(audio.file);
      
      // Subscribe the connection to the player and play the resource
      connection.subscribe(player);
      player.play(resource);

      player.on('idle', async () => {
        // Delete the file after it's played
        try {
          fs.unlinkSync(audio.file);
        } catch (err) {
          logToConsole(`X Failed to delete file: ${err.message}`, 'error', 1);
        }

        // Remove the played audio from the queue
        audioqueue = audioqueue.filter(a => a.index !== currentIndex);
        currentIndex++;
        retryCount = 0; // Reset retry count for the next index

        if (audioqueue.length > 0) {
          await playAudioQueue(connection, channel, userid); // Continue playing
        } else {
          currentlythinking = false;
          audioqueue = [];
          currentIndex = 0;
          retryCount = 0;
          logToConsole('> Audio queue finished.', 'info', 2);
        }
      });

      player.on('error', error => logToConsole(`Error: ${error.message}`, 'error', 1));

      break; // Exit the while loop after setting up the player for the current index
    } else {
      // If the expected index is not found, wait 1 second and increase the retry count
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        retryCount++;
      } else {
        currentlythinking = false;
        audioqueue = [];
        currentIndex = 0;
        retryCount = 0;
        logToConsole(`X Failed to find audio with index ${currentIndex} after ${maxRetries} retries.`, 'error', 1);
        break; // Give up after exceeding retry limit
      }
    }
  }
}

async function playSound(connection, sound) {
  // Check if allowwithouttrigger is true, if yes ignore
  if (allowwithouttrigger && sound !== 'command') {
    return;
  }

  // Check if the sound file exists
  if (!fs.existsSync(`./sounds/${sound}.mp3`)) {
    logToConsole(`X Sound file not found: ${sound}.mp3`, 'error', 1);
    return;
  }

  // Create an audio player
  const player = createAudioPlayer();

  // Create an audio resource from a local file
  const resource = createAudioResource('./sounds/'+sound+'.mp3');

  // Subscribe the connection to the player and play the resource
  connection.subscribe(player);
  player.play(resource);

  player.on('error', error => logToConsole(`Error: ${error.message}`, 'error', 1));
}

function restartListening(userID, connection, channel) {
  handleRecordingForUser(userID, connection, channel);
}

function logToConsole(message, level, type) {
  switch (level) {
    case 'info':
      if (process.env.LOG_TYPE >= type) {
        console.info(message);
      }
      break;
    case 'warn':
      if (process.env.LOG_TYPE >= type) {
        console.warn(message);
      }
      break;
    case 'error':
      console.error(message);
      break;
  }
}

client.login(TOKEN);