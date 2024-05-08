require('dotenv').config();

const { Client, GatewayIntentBits, Intents } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, EndBehaviorType } = require('@discordjs/voice');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const prism = require('prism-media');
const ytdl = require('ytdl-core');
const { google } = require('googleapis');
const { log } = require('console');
const { send } = require('process');

let connection = null;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API
});

const TOKEN = process.env.DISCORD_TOKEN;
const botnames = process.env.BOT_TRIGGERS.split(',');
if (!Array.isArray(botnames)) {
  logToConsole('BOT_TRIGGERS must be an array of strings', 'error', 1);
  process.exit(1);
}
logToConsole(`Bot triggers: ${botnames}`, 'info', 1);
let chatHistory = {};

let allowwithouttrigger = false;
let allowwithoutbip = false;
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
  switch (message.content.split(' ')[0]) {
    case '>join':
      allowwithoutbip = false;
      allowwithouttrigger = false;

      // Check if second argument is silent
      if (message.content.split(' ')[1] === 'silent') {
        allowwithoutbip = true;
      }
      else if (message.content.split(' ')[1] === 'free') {
        allowwithouttrigger = true;
      }

      allowwithouttrigger = false;
      if (message.member.voice.channel) {
        // Delete user's message for spam
        message.delete();

        connection = joinVoiceChannel({
          channelId: message.member.voice.channel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
          selfDeaf: false,
        });
        handleRecording(connection, message.member.voice.channel);
      } else {
        message.reply('You need to join a voice channel first!');
      }
      break;
    case '>reset':
      chatHistory = {};
      message.reply('> Chat history reset!');
      break;
    case '>play':
      if (message.member.voice.channel) {
        // Play YouTube video
        seatchAndPlayYouTube(message.content.replace('>play', '').trim(), message.author.id, connection, message.member.voice.channel);
      } else {
        message.reply('You need to join a voice channel first!');
      }
      break;
    case '>help':
      message.reply('Commands: \n>join - Join voice channel and start listening for trigger words \n>join silent - Join voice channel without the confirmation sounds \n>join free - Join voice channel and listen without trigger words \n>reset - Reset chat history \n>play [song name or URL] - Play a song from YouTube');
      break;
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
      logToConsole('> Bot is already thinking, ignoring transcription.', 'info', 2);
      restartListening(userId, connection, channel);
      return;
    }

    // Check if transcription is a command
    if (transcription.toLowerCase().includes("reset") && transcription.toLowerCase().includes("chat") && transcription.toLowerCase().includes("history")) {
      playSound(connection, 'command');
      currentlythinking = false;
      chatHistory = {};
      logToConsole('> Chat history reset!', 'info', 1);
      restartListening(userId, connection, channel);
      return;
    }
    else if (transcription.toLowerCase().includes("leave") && transcription.toLowerCase().includes("voice") && transcription.toLowerCase().includes("chat")) {
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
        for (const name of botnames) {
          transcription = transcription.replace(new RegExp(`\\b${name}\\b`, 'i'), '').trim();
        }

        // CHeck if transcription is requesting a song
        const songTriggers = [['play', 'song'], ['play', 'youtube']];
        const timerTriggers = [['set', 'timer'], ['start', 'timer'], ['set', 'alarm'], ['start', 'alarm']];
        const stopTriggers = ['stop', 'playback'];
        const internetTriggers = ['search', 'internet'];

        if (stopTriggers.some(trigger => transcription.toLowerCase().includes(trigger))) {
          playSound(connection, 'command');
          currentlythinking = false;
          audioqueue = [];
          logToConsole('> Bot stopped thinking.', 'info', 1);
          restartListening(userId, connection, channel);
          return;
        }
        else if (songTriggers.some(triggers => triggers.every(trigger => transcription.toLowerCase().includes(trigger)))) {
          currentlythinking = true;
          playSound(connection, 'understood');
          // Remove the song triggers from the transcription
          for (const trigger of songTriggers) {
            for (const word of trigger) {
              transcription = transcription.replace(word, '').trim();
            }
          }
          seatchAndPlayYouTube(transcription, userId, connection, channel);
          restartListening(userId, connection, channel);
          return;
        }
        else if (timerTriggers.some(triggers => triggers.every(trigger => transcription.toLowerCase().includes(trigger)))) {
          currentlythinking = true;
          playSound(connection, 'understood');
          // Remove the timer triggers from the transcription
          for (const trigger of timerTriggers) {
            for (const word of trigger) {
              transcription = transcription.replace(word, '').trim();
            }
          }
          // Send to timer API
          setTimer(transcription, userId, connection, channel);
          restartListening(userId, connection, channel);
          return;
        }
        else if (internetTriggers.some(trigger => transcription.toLowerCase().includes(trigger))) {
          currentlythinking = true;
          playSound(connection, 'understood');
          // Remove the internet triggers from the transcription
          for (const word of internetTriggers) {
            transcription = transcription.replace(word, '').trim();
          }
          // Send to search API
          sendToPerplexity(transcription, userId, connection, channel);
          restartListening(userId, connection, channel);
          return;
        }

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
      const llmresponse = response.data.choices[0].message.content;
      logToConsole(`> LLM Response: ${llmresponse}`, 'info', 1);

      if(llmresponse.includes("IGNORING")){
        currentlythinking = false;
        logToConsole('> LLM Ignored the command.', 'info', 2);
        return;
      }

      // Store the LLM's response in the history
      messages.push({
        role: 'assistant',
        content: llmresponse
      });
      
      // Update the chat history
      chatHistory[userId] = messages;

      // Send response to TTS service
      playSound(connection, 'result');
      sendToTTS(llmresponse, userId, connection, channel);
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

async function sendToPerplexity(transcription, userId, connection, channel) {
  let messages = chatHistory[userId] || [];

  // Return error if perplexity key is missing
  if(process.env.PERPLEXITY_API === undefined || process.env.PERPLEXITY_API === "" || process.env.PERPLEXITY_MODEL === "MY_PERPLEXITY_API_KEY"){
    logToConsole('X Perplexity API key is missing', 'error', 1);
    sendToTTS('Sorry, I do not have access to internet. You may add a Perplexity API key to add this feature.', userId, connection, channel);
    return;
  }

  // System prompt not allowed on Perplexity search
  
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
      baseURL: process.env.PERPLEXITY_ENDPOINT,
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Chat completion without streaming
    client.post('/chat/completions', {
      model: process.env.PERPLEXITY_MODEL,
      messages: messages,
    })
    .then((response) => {
      const llmresponse = response.data.choices[0].message.content;
      logToConsole(`> LLM Response: ${llmresponse}`, 'info', 1);

      if(llmresponse.includes("IGNORING")){
        currentlythinking = false;
        logToConsole('> LLM Ignored the command.', 'info', 2);
        return;
      }

      // Store the LLM's response in the history
      messages.push({
        role: 'assistant',
        content: llmresponse
      });
      
      // Update the chat history
      chatHistory[userId] = messages;

      // Send response to TTS service
      playSound(connection, 'result');
      sendToTTS(llmresponse, userId, connection, channel);
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

async function playSound(connection, sound, volume = 1) {
  // Check if allowwithouttrigger is true, if yes ignore
  if ((allowwithouttrigger || allowwithoutbip) && sound !== 'command') {
    return;
  }

  // Check if the sound file exists
  if (!fs.existsSync(`./sounds/${sound}.mp3`)) {
    logToConsole(`X Sound file not found: ${sound}.mp3`, 'error', 1);
    return;
  }

  // Create a stream from the sound file using ffmpeg
  const stream = fs.createReadStream(`./sounds/${sound}.mp3`);
  const ffmpegStream = ffmpeg(stream)
    .audioFilters(`volume=${volume}`)
    .format('opus')
    .on('error', (err) => console.error(err))
    .stream();

  // Create an audio resource from the ffmpeg stream
  const resource = createAudioResource(ffmpegStream);
  const player = createAudioPlayer();

  // Subscribe the connection to the player and play the resource
  player.play(resource);
  connection.subscribe(player);

  player.on('error', error => logToConsole(`Error: ${error.message}`, 'error', 1));
  player.on('stateChange', (oldState, newState) => {
    if (newState.status === 'idle') {
      logToConsole('> Finished playing sound.', 'info', 2);
    }
  });
}

function restartListening(userID, connection, channel) {
  handleRecordingForUser(userID, connection, channel);
}

async function seatchAndPlayYouTube(songName, userid, connection, channel) {
  // Check if songName is actually a YouTube URL
  let videoUrl = songName;
  if (!songName.includes('youtube.com')){
    videoUrl = await searchYouTube(songName);
  }

  if (!videoUrl) {
      // If no video was found, voice it out
      sendToTTS('Sorry, I could not find the requested song.', userid, connection, channel);
  }

  logToConsole(`> Playing YouTube video: ${videoUrl}`, 'info', 1);

  const stream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio' });
  const ffmpegStream = ffmpeg(stream)
      .audioFilters(`volume=0.05`)
      .format('opus')
      .on('error', (err) => console.error(err))
      .stream();

  const resource = createAudioResource(ffmpegStream);
  const player = createAudioPlayer();

  player.play(resource);
  connection.subscribe(player);

  player.on('stateChange', (oldState, newState) => {
      if (newState.status === 'idle') {
        currentlythinking = false;
        logToConsole('> Finished playing YouTube.', 'info', 1);
      }
  });
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

async function searchYouTube(query) {
  if(process.env.YOUTUBE_API === undefined || process.env.YOUTUBE_API === "" || process.env.YOUTUBE_API === "MY_YOUTUBE_API_KEY"){
    logToConsole('X YouTube API key is missing', 'error', 1);
    sendToTTS('Sorry, I do not have access to YouTube. You may add a YouTube API key to add this feature.', userid, connection, channel);
    return null;
  }
  const res = await youtube.search.list({
      part: 'snippet',
      q: query,
      maxResults: 1,
      type: 'video'
  });
  const videos = res.data.items;
  if (!videos.length) return null;
  return `https://www.youtube.com/watch?v=${videos[0].id.videoId}`;
}

async function setTimer(query, userid, connection, channel) {
  // Check for known time units (minutes, seconds, hours) with a number
  const timeUnits = ['minutes', 'minute', 'seconds', 'second', 'hours', 'hour'];
  const timeUnit = timeUnits.find(unit => query.includes(unit));
  const timeValue = query.match(/\d+/);

  if (!timeUnit || !timeValue) {
    sendToTTS('Sorry, I could not understand the requested timer.', userid, connection, channel);
    return;
  }

  const time = parseInt(timeValue[0]);
  const ms = timeUnit.includes('minute') ? time * 60000 : timeUnit.includes('second') ? time * 1000 : time * 3600000;

  sendToTTS(`Timer set for ${time} ${timeUnit}`, userid, connection, channel);
  logToConsole(`> Timer set for ${time} ${timeUnit}`, 'info', 1);
  setTimeout(() => {
    playSound(connection, 'alarm', 0.05);
    logToConsole('> Timer finished.', 'info', 1);
  }, ms);

  restartListening(userid, connection, channel);
}

client.login(TOKEN);