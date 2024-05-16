const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

const commands = [
  {
    name: 'join',
    description: 'Join voice channel',
    options: [
      {
        type: 3, // STRING
        name: 'mode',
        description: 'The mode to join in',
        required: false,
        choices: [
          {
            name: 'silent',
            value: 'silent',
            description: "The bot won't produce any sound in this mode (confirmation, processed, etc.)",
          },
          {
            name: 'free',
            value: 'free',
            description: 'The bot does not need trigger word to talk and will respond to any voice input. This mode is not recommended for general use.',
          },
          {
            name: 'transcribe',
            value: 'transcribe',
            description: 'The bot will save a transcription of the conversation and send it to the channel after using the `leave` command.',
          },
        ],
      },
    ],
  },
  {
    name: 'reset',
    description: 'Reset voice chat history',
  },
  {
    name: 'play',
    description: 'Play a song from YouTube',
    options: [
      {
        type: 3, // STRING
        name: 'query',
        description: 'The song name or URL to play',
        required: true,
      },
    ],
  },
  {
    name: 'search',
    description: 'Search internet with LLM',
    options: [
      {
        type: 3, // STRING
        name: 'query',
        description: 'Your query',
        required: true,
      },
    ],
  },
  {
    name: 'reminder',
    description: 'Set a reminder',
    options: [
      {
        type: 3, // STRING
        name: 'time',
        description: 'Time to remind, in timestamp format (e.g. <t:1715869560>)',
        required: true,
      },
      {
        type: 3, // STRING
        name: 'message',
        description: 'Message to remind',
        required: true,
      },
    ],
  },
  {
    name: 'leave',
    description: 'Leave voice channel',
  },
  {
    name: 'help',
    description: 'Display help message',
  },
];

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_ID),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();