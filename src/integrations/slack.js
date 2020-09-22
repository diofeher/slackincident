var rp = require('request-promise');
const request = require('request');


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
        text: incidentManager + ' will join soon as incident manager',
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
        "fallback": "Join Incident Channel #" + incidentSlackChannel,
        "actions": [
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


function sendSlackMessageToChannel(slackChannel, slackMessage, pin_message) {
    if (process.env.DRY_RUN) {
        console.log("Sending message below to channel " + slackChannel);
        console.log(slackMessage);
        return;
    }
    const newMessage = {
        ...slackMessage,
        channel: slackChannel
    };

    request.post({
            url: 'https://slack.com/api/chat.postMessage',
            auth: {
                'bearer': process.env.SLACK_API_TOKEN
            },
            json: newMessage
        },
        function (error, response, body) {
            if (error) {
                console.error('Sending message to Slack channel failed:', error);
                throw new Error('Sending message to Slack channel failed');
            }
            if (pin_message) {
                var ts = body['ts'];
                var channel = body['channel'];
                request.post({
                        url: 'https://slack.com/api/pins.add',
                        auth: {
                            'bearer': process.env.SLACK_API_TOKEN
                        },
                        json: {
                            'channel': channel,
                            'timestamp': ts
                        }
                    }, (error, response) => {
                        if (error) {
                            console.log('Error pinning message to channel: ' + error);
                        }
                    }
                );
            }
        });
}

function setChannelTopic(channelId, topic) {
    request.post({
            url: 'https://slack.com/api/conversations.setTopic',
            auth: {
                'bearer': process.env.SLACK_API_TOKEN
            },
            json: {
                'channel': channelId,
                'topic': topic
            }
        },
        function (error, response, body) {
            if (error || !body['ok']) {
                console.log('Error setting topic for channel ' + channelId);
                console.log(body, error);
            }
        });
}

async function createSlackChannel(incidentName, incidentCreatorSlackUserId, incidentSlackChannel) {
    const res = await rp.post({
        url: 'https://slack.com/api/conversations.create',
        auth: {
            'bearer': process.env.SLACK_API_TOKEN
        },
        json: {
            name: incidentSlackChannel
            // is_private:
        }
    });

    let channelId = res.channel.id;

    setChannelTopic(channelId, incidentName + '. Please join conference call. See pinned message for details.');
    inviteUser(channelId, incidentCreatorSlackUserId);
    return res.channel.id;
}


function inviteUser(channelId, userId) {
    request.post({
            url: 'https://slack.com/api/conversations.invite',
            auth: {
                'bearer': process.env.SLACK_API_TOKEN
            },
            json: {
                'channel': channelId,
                'users': [userId]
            }
        },
        function (error, response, body) {
            if (error || !body['ok']) {
                console.log('Error inviting user for channel');
                console.log(body, error);
            }
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

function sendConferenceCallDetailsToChannel(incidentSlackChannelId, eventDetails) {
    var entryPoints = eventDetails.conferenceData.entryPoints;
    var title_link;
    var text;
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
        "color": "#1F8456",
        "title": "Join Conference Call",
        "title_link": title_link,
        "text": title_link,
        "fields": [
            {
                "title": "Join by phone",
                "value": "<" + tel_link + ",," + pin + "%23" + "|" + tel + " PIN: " + pin + "#>",
                "short": false
            }
        ],
        "actions": [
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
    sendSlackMessageToChannel(incidentSlackChannelId, slackMessage, true);
}

const getChannelInfo = async (channel) => {
    const response =  await rp.post({
        url: 'https://slack.com/api/conversations.info',
        auth: {
            'bearer': process.env.SLACK_API_TOKEN
        },
        form: {
            channel,
        }
    })
    return JSON.parse(response).channel;
}

const getProfileInfo = async (user) => {
    const response = await rp.post({
        url: 'https://slack.com/api/users.profile.get',
        auth: {
            'bearer': process.env.SLACK_API_TOKEN
        },
        form: {
            user,
        }
    })
    return JSON.parse(response).profile;
}

const getBotInfo = async (bot) => {
    const response = await rp.post({
        url: 'https://slack.com/api/bots.info',
        auth: {
            'bearer': process.env.SLACK_API_TOKEN
        },
        form: {
            bot,
        }
    });
    return JSON.parse(response).bot;
}

const getMembersChannel = async (channel) => {
    const response = await rp.post({
        url: 'https://slack.com/api/conversations.members',
        auth: {
            'bearer': process.env.SLACK_API_TOKEN
        },
        form: {
            channel,
        }
    });
    return JSON.parse(response).members;
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
