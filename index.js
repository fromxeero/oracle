// Global Var
let currentResource = null; 
let globalVolume = 0.5; // Default Vol of 50%

// Bot Init

const { Client, GatewayIntentBits } = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus, 
    VoiceConnectionStatus 
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const PREFIX = '?';
const MUSIC_DIR = path.join(__dirname, 'Music Files');

let playlist = [];
let playlistOrder = [];
let loopEnabled = false;
let player = null;
let connection = null;
let currentTextChannel = null;
let currentVoiceChannel = null;

// Make sure the music is actually there

if (!fs.existsSync(MUSIC_DIR)) {
    fs.mkdirSync(MUSIC_DIR);
}

// Read dir and shuff-le files
function loadShuffledPlaylist() {
    const files = fs.readdirSync(MUSIC_DIR)
        .filter(file => file.endsWith('.mp3'))
        .map(file => path.join(MUSIC_DIR, file));

    // Shuffle Algo (Fischer-Yates)
    for (let i = files.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [files[i], files[j]] = [files[j], files[i]];
    }
    return files;
}

function setVoiceChannelStatus(channel, status) {
    if (!channel) return;

    client.rest.put(`/channels/${channel.id}/voice-status`, {
        body: { status }
    }).catch(error => {
        console.error(`Failed to update voice channel status: ${error.message}`);
    });
}

// Play next song, if no more then message that out of songs

function playNext() {
    if (playlist.length === 0) {
        if (loopEnabled && playlistOrder.length > 0) {
            playlist = playlistOrder.slice();
        } else {
            if (client.user) client.user.setPresence({ activities: [] });
            setVoiceChannelStatus(currentVoiceChannel, null);
            if (currentTextChannel) currentTextChannel.send("<:wave:1571594141975187596> You have reached the end... for now <:ohmygod:1571594146991443972>");
            return;
        }
    }

    const nextSongPath = playlist.shift();
    const songName = path.basename(nextSongPath, path.extname(nextSongPath));
    if (client.user) client.user.setActivity(songName);
    setVoiceChannelStatus(currentVoiceChannel, songName);

    // Inline vol enable
    currentResource = createAudioResource(nextSongPath, { inlineVolume: true });
    
    // Global vol application
    currentResource.volume.setVolume(globalVolume);

    player.play(currentResource);
}

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
    // Ignore all non prefixed messages
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'play') {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.reply("<:sideposture:1571594144252559552> You need to be in VC to use this command!");
        }

        currentTextChannel = message.channel;
        playlist = loadShuffledPlaylist();
        playlistOrder = playlist.slice();

        if (playlist.length === 0) {
            return message.reply("<:ohmygod:1571594146991443972> The folder containing music is empty! Put some files there first.");
        }

        if (currentVoiceChannel && currentVoiceChannel.id !== voiceChannel.id) {
            setVoiceChannelStatus(currentVoiceChannel, null);
        }
        currentVoiceChannel = voiceChannel;

        // vc connect
        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });

        // Create audio player if not already
        if (!player) {
            player = createAudioPlayer();

            // Autoplay next song
            player.on(AudioPlayerStatus.Idle, () => {
                playNext();
            });
            // Error
            player.on('error', error => {
                console.error(`Error: ${error.message}`);
                playNext();
            });
        }

        connection.subscribe(player);
        message.channel.send(`<:oracle:1571594132789534821> Loaded and shuffled **${playlist.length}** songs. Playback Starting...`);
        playNext();
    }

    if (command === 'skip') {
        if (player && player.state.status !== AudioPlayerStatus.Idle) {
            message.channel.send("<a:vibe:1571594140016185486> Skipped current track.");
            player.stop(); // Idle State
        } else {
            message.reply("Nothing is playing right now.");
        }
    }

    if (command === 'pause') {
        if (player && player.state.status === AudioPlayerStatus.Playing) {
            player.pause();
            message.channel.send("<:shrug:1571594137969496095> Playback paused.");
        } else if (player && player.state.status === AudioPlayerStatus.Paused) {
            message.reply("<:uwu:1571594134995865610> Playback is already paused.");
        } else {
            message.reply("<:ohmygod:1571594146991443972> Nothing is playing right now.");
        }
    }

    if (command === 'resume') {
        if (player && player.state.status === AudioPlayerStatus.Paused) {
            player.unpause();
            message.channel.send("<:uwu:1571594134995865610> Playback resumed.");
        } else if (player && player.state.status === AudioPlayerStatus.Playing) {
            message.reply("<:smug:1571594136413544448> Playback is already playing.");
        } else {
            message.reply("<:oracle:1571594132789534821> Nothing is paused right now.");
        }
    }

    if (command === 'loop') {
        loopEnabled = !loopEnabled;
        message.channel.send(`<a:vibe:1571594140016185486> Playlist looping ${loopEnabled ? 'enabled' : 'disabled'}.`);
    }

    if (command === 'stop') {
        playlist = [];
        playlistOrder = [];
        if (client.user) client.user.setPresence({ activities: [] });
        setVoiceChannelStatus(currentVoiceChannel, null);
        currentVoiceChannel = null;
        if (player) player.stop();
        if (connection) {
            connection.destroy();
            connection = null;
            message.channel.send("<:wave:1571594141975187596> Stopped playback and left the voice channel.");
        } else {
            message.reply("<:smug:1571594136413544448>I'm not connected to a voice channel.");
        }
    }

   // !vol
    if (command === 'volume' || command === 'vol') {
        const volArg = args[0];

        // Print current volume when no amount given
        if (!volArg) {
            return message.reply('<:sideposture:1571594144252559552> Current volume is **${Math.round(globalVolume * 100)}%**`');
        }

        const volumePercent = parseInt(volArg, 10);

        // Validating input
        if (isNaN(volumePercent) || volumePercent < 0 || volumePercent > 100) {
            return message.reply("<:smug:1571594136413544448> Not a valid volume level");
        }

        // int to float scale
        globalVolume = volumePercent / 100;

        // Fade volume if active media
        if (currentResource && currentResource.volume) {
            currentResource.volume.setVolume(globalVolume);
        }

        return message.channel.send(`<a:vibe:1571594140016185486> Volume set to **${volumePercent}%**`);
    }
});

// Enable "Message Content Intent" in Dev Portal for token to work
client.login('YOUR_BOT_TOKEN_HERE');