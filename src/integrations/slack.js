const axios = require('axios');


const slackClient = axios.create({
    baseURL: "https://slack.com/api/",
    headers: {
        Authorization: `Bearer ${process.env.SLACK_API_TOKEN}`
    },
    "Content-Type": "application/json",
});

slackClient.interceptors.response.use(function (response) {
    const { data, config: { url, method }} = response;

    if(!data.ok) {
        console.error(url, method, data);
    }
    return response;
  }, function (error) {
    return Promise.reject(error);
  });


function sendIncidentManagerJoiningSoonMessageToChannel(incidentSlackChannelId, incidentManager) {
    var emoji = Math.random() < 0.5 ? ':male-firefighter:' : ':female-firefighter:';
    var slackMessage = {
        username: 'Incident Manager',
        icon_emoji: emoji,
        channel: '',
        attachments: [],
        link_names: true,
        parse: 'full',
    };

    slackMessage.attachments.push({
        color: '#FF0000',
        text: incidentManager + ' will join soon as incident manager. Please join the conference call. See pinned messages for details.',
    });
    sendSlackMessageToChannel(incidentSlackChannelId, slackMessage);
}


function createInitialMessage(incidentName, slackUserName, incidentSlackChannel, incidentSlackChannelId) {
    // Prepare a rich Slack message
    // See https://api.slack.com/docs/message-formatting
    var slackMessage = {
        username: 'Incident Management',
        icon_emoji: ':warning:',
        attachments: [],
        link_names: true,
        parse: 'full',
    };

    slackMessage.attachments.push({
        color: '#8f0000',
        title: incidentName,
        text: "Incident Channel: #" + incidentSlackChannel,
        fallback: "Join Incident Channel #" + incidentSlackChannel,
        actions: [
            {
                "type": "button",
                "text": "Join Incident Channel",
                "url": "slack://channel?team=" + process.env.SLACK_TEAM_ID + "&id=" + incidentSlackChannelId,
                "style": "danger"
            }
        ],
        footer: `reported by @${slackUserName}`
    });
    return slackMessage;
}


const sendSlackMessageToChannel = async (channel, slackMessage, pin_message) => {
    if (process.env.DRY_RUN) {
        console.log("Sending message below to channel " + channel);
        console.log(slackMessage);
        return;
    }
    const newMessage = {
        ...slackMessage,
        channel,
    };

    const { data } = await slackClient.post('/chat.postMessage', newMessage);

    if (pin_message) {
        var ts = data['ts'];
        var channel = data['channel'];
        const { data: pinData } = await slackClient.post('/pins.add', { channel, timestamp: ts });
    }
}

const setChannelTopic = async (channel, topic) => {
    return await slackClient.post('/conversations.setTopic', { channel, topic });
}

const createSlackChannel = async (incidentName, incidentCreatorSlackUserId, slackChannel) => {
    const { data } = await slackClient.post('/conversations.create', {
        name: slackChannel
        // is_private:
    });

    let channelId = data.channel.id;

    setChannelTopic(channelId, incidentName + '. Please join conference call. See pinned message for details.');
    inviteUser(channelId, incidentCreatorSlackUserId);
    return channelId;
}


const inviteUser = async (channel, userId) => {
    await slackClient.post('/conversations.invite', {
        channel,
        users: [userId]
    });
}


function sendEpicToChannel(incidentSlackChannelId, epicUrl) {
    var slackMessage = {
        username: 'After the incident',
        icon_emoji: ':dart:',
        channel: '',
        attachments: [],
        link_names: true,
        parse: 'full',
    };
    // Epic link
    slackMessage.attachments.push({
        color: '#FD6A02',
        title: 'Discuss and track follow-up actions',
        title_link: epicUrl,
        text: epicUrl,
        footer: 'Remember: Don\'t Neglect the Post-Mortem!'
    });
    sendSlackMessageToChannel(incidentSlackChannelId, slackMessage);
}

function sendConferenceCallDetailsToChannel(channelId, eventDetails) {
    var entryPoints = eventDetails.conferenceData.entryPoints;
    var title_link;
    var more_phones_link;
    var tel;
    var tel_link;
    var pin;
    var regionCode;
    for (var i = 0; i < entryPoints.length; i++) {
        var entryPoint = entryPoints[i];
        var type = entryPoint.entryPointType;
        if (type == 'video') {
            title_link = entryPoint.uri;
            text = entryPoint.label;
        }
        if (type == 'phone') {
            tel_link = entryPoint.uri;
            tel = entryPoint.label;
            pin = entryPoint.pin;
            regionCode = entryPoint.regionCode;
        }
        if (type == 'more') {
            more_phones_link = entryPoint.uri;
        }
    }

    var confDetailsMessage = {
        color: "#1F8456",
        title: "Join Conference Call",
        "title_link": title_link,
        text: title_link,
        fields: [
            {
                "title": "Join by phone",
                "value": "<" + tel_link + ",," + pin + "%23" + "|" + tel + " PIN: " + pin + "#>",
                "short": false
            }
        ],
        actions: [
            {
                "type": "button",
                "text": "Join Conference Call",
                "url": title_link,
                "style": "primary"
            }
        ],

        "footer": "Not in " + regionCode + "? More phone numbers at " + more_phones_link
    }

    var slackMessage = {
        username: 'Conference Call Details',
        icon_emoji: ':telephone_receiver:',
        channel: '',
        attachments: [],
        link_names: true,
        parse: 'none',
        mrkdwn: true,
    };
    slackMessage.attachments.push(confDetailsMessage);
    sendSlackMessageToChannel(channelId, slackMessage, true);
}

const getChannelInfo = async (channel) => {
    const params = { channel };
    const { data } = await slackClient.get('/conversations.info', { params });
    return data;
}

const getProfileInfo = async (user) => {
    const { data } = await slackClient.get('/users.profile.get', { params: { user }});
    return data.profile;
}

const getBotInfo = async (bot) => {
    const { data } = await slackClient.get('/bots.info', { params: { bot }});
    return data.bot;
}

const getMembersChannel = async (channel) => {
    const { data } = await slackClient.post('/conversations.members', { channel });
    console.log('getMembersChannel', data);
    return data.members;
}


module.exports = {
    getProfileInfo,
    getBotInfo,
    getMembersChannel,
    getChannelInfo,
    sendEpicToChannel,
    createInitialMessage,
    sendConferenceCallDetailsToChannel,
    sendIncidentManagerJoiningSoonMessageToChannel,
    sendSlackMessageToChannel,
    setChannelTopic,
    createSlackChannel,
}
