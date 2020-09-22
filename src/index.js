'use strict';

const http = require('http');
const qs = require('querystring');
// const {google} = require('googleapis'); // Add "googleapis": "^33.0.0", to package.json 'dependencies' when you enable this again.
const request = require('request');
const moment = require('moment');

const gapi = require("./integrations/googleapi.js");
const rp = require('request-promise');
const date = require('date-and-time');
const pagerduty = require('./integrations/pagerduty');
const slack = require('./integrations/slack');
const jira = require('./integrations/jira');
const googleapi = require('./integrations/googleapi.js');


const CONSTANTS = {
    BREAK_GLASS_OFFTIME: 30 * 60,  // minutes
}

const COLORS = {
    RED: '#FF0000',
    GREEN: '#008000',
}

const removeInactiveIncidentMembers = async (channelID) => {
    const activeIncidents = (await pagerduty.getActiveIncidents())?.incidents;

    var detailedIncidents = await Promise.all(activeIncidents.map(async (incident) => {
        const details = await pagerduty.getIncidentDetails(incident.id);
        const members = await slack.getMembersChannel(details.slack_channel);
        return members || [];
    }));
    const membersActiveIncidents = [...new Set(detailedIncidents.flat())];

    const activeMembers = await slack.getMembersChannel(channelID);

    (activeMembers || []).map(async (member) => {
        if(!membersActiveIncidents.includes(member)) {
            const email = (await slack.getProfileInfo(member)).email;
            email && googleapi.removeUserFromGroup(email);
        };
    });
}

function sendIncidentLogFileToChannel(incidentSlackChannelId, docUrl) {
    var slackMessage = {
        username: 'During the incident',
        icon_emoji: ':pencil:',
        channel: '',
        attachments: [],
        link_names: true,
        parse: 'full',
    };

    // Google Doc
    slackMessage.attachments.push({
        color: '#3367d6',
        title: 'Notes & Actions',
        title_link: docUrl,
        text: docUrl,
        footer: 'Use this document to to maintain a timeline of key events during an incident. Document actions, and keep track of any followup items that will need to be addressed.'
    });
    slack.sendSlackMessageToChannel(incidentSlackChannelId, slackMessage);
}


function verifyPostRequest(method) {
    if (method !== 'POST') {
        const error = new Error('Only POST requests are accepted');
        error.code = 405;
        throw error;
    }
}

function verifySlackWebhook(body) {
    if (!body || body.token !== process.env.SLACK_COMMAND_TOKEN) {
        const error = new Error('Invalid credentials');
        error.code = 401;
        throw error;
    }
}

async function createIncidentFlow(body) {
    var incidentId = moment().format('YYYYMMDDHHmmss');
    var incidentName = body.text;
    var incidentCreatorSlackHandle = body.user_name;
    var incidentCreatorSlackUserId = body.user_id;

    var prefix = process.env.SLACK_INCIDENT_CHANNEL_PREFIX;
    if (!prefix) {
        prefix = 'incident-';
    }

    var incidentSlackChannel = prefix + incidentId;
    if (!incidentName) {
        incidentName = incidentSlackChannel;
    }

    var incidentSlackChannelID = await slack.createSlackChannel(incidentName, incidentCreatorSlackUserId, incidentSlackChannel);

    pagerduty.alertIncidentManager(incidentName, incidentSlackChannelID, incidentCreatorSlackHandle);
    createAdditionalResources(incidentId, incidentName, incidentSlackChannelID, incidentSlackChannel, incidentCreatorSlackHandle);

    return incidentSlackChannelID;
}


const createAdditionalResources = async (incidentId, incidentName, incidentSlackChannelId, incidentSlackChannel, incidentCreatorSlackHandle) => {
    const { data: {event: eventDetails} } = await gapi.registerIncidentEvent(incidentId,
        incidentName,
        incidentCreatorSlackHandle,
        incidentSlackChannel,
    );

    slack.sendConferenceCallDetailsToChannel(incidentSlackChannelId, eventDetails);

    var fileName = incidentSlackChannel;
    const url = await gapi.createIncidentsLogFile(fileName,
        process.env.GDRIVE_INCIDENT_NOTES_FOLDER,
        incidentName,
        incidentCreatorSlackHandle,
    );

    sendIncidentLogFileToChannel(incidentSlackChannelId, url);

    jira.createFollowupsEpic(incidentName, incidentSlackChannelId, incidentSlackChannel);

    // Return a formatted message
    var slackMessage = slack.createInitialMessage(incidentName, incidentCreatorSlackHandle, incidentSlackChannel, incidentSlackChannelId);

    if(process.env.SLACK_INCIDENTS_CHANNEL){
        var channelsToNotify = process.env.SLACK_INCIDENTS_CHANNEL.split(",");
        for(var i=0;i<channelsToNotify.length;i++){
            sendSlackMessageToChannel("#" + channelsToNotify[i], slackMessage);
        }
    }

    //remove join button from initial message and then send to incident channel
    slackMessage.attachments[0].actions.shift();
    slack.sendSlackMessageToChannel(incidentSlackChannelId, slackMessage)
}


const onIncidentAcknowledgement = (message) => {
    pagerduty.onIncidentManagerAcknowledge(message);
}

const onIncidentManagerResolved = async (message) => {
    const details = await pagerduty.getIncidentDetails(message.incident.id);
    const imEmail = await pagerduty.onIncidentManagerResolved(message);
    const totalActiveEvents = await pagerduty.getTotalActiveIncidents();

    if(totalActiveEvents > 0) {
        console.debug('Other incidents workflow...');
        removeInactiveIncidentMembers(details.slack_channel);
    } else {
        console.debug('Zero active incidents workflow...');
        googleapi.clearGroupMembers();
    }

    var slackMessage = {
        icon_emoji: ':sweat_drops:',
        attachments: [
            {color: COLORS.GREEN, text: `Controlled burning. Incident Resolved.`}
        ],
    };
    slack.sendSlackMessageToChannel(details.slack_channel, slackMessage);
}

const onBreakGlass = async (body) => {
    const channelId = body.channel_id;
    const username = body.user_name;

    const currentTime = new Date();
    const pagerDutyDetails = await pagerduty.getIncidentBySlackChannel(channelId);
    const incidentCreatedTime = new Date(pagerDutyDetails.created_at);
    const delta = (currentTime - incidentCreatedTime);

    if (delta / 1000 > CONSTANTS.BREAK_GLASS_OFFTIME) {
        var slackMessage = {
            icon_emoji: ':x:',
            attachments: [{
                text: `${username} cannot break the glass anymore. Time has passed.`,
                color: COLORS.RED,
            }],
        };
        slack.sendSlackMessageToChannel(channelId, slackMessage);
        return;
    }

    const botProfileInfo = await slack.getProfileInfo();
    const botUserInfo = await slack.getBotInfo(botProfileInfo?.bot_id);
    const chanInfo = await slack.getChannelInfo(channelId);

    if (botUserInfo.user_id != chanInfo?.creator) {
        var slackMessage = {
            icon_emoji: ':x:',
            attachments: [{
                color: COLORS.RED,
                text: `This command can be used only on channels created by the bot. Break glass won't work here.`,
            }]
        };
        slack.sendSlackMessageToChannel(body.user_id, slackMessage);
        return;
    }


    var slackMessage = {
        icon_emoji: ':fire_engine:',
        attachments: [{
            text: `${username} broke the glass. With great power comes great responsibility.`,
            color: COLORS.RED,
        }],
    };
    slack.sendSlackMessageToChannel(channelId, slackMessage);
    const userInfo = await slack.getProfileInfo(body.user_id);
    googleapi.addUserToGroup(userInfo.email);
}


http.createServer(function (req, res) {
    try {
        verifyPostRequest(req.method);

        var body = '';
        var post = {};
        req.on('data', function (chunk) {
            body += chunk;
        });

        if(req.url.includes("/break-glass")) {
            req.on('end', async function () {
                post = qs.parse(body);
                onBreakGlass(post);
                res.end();
            });
        }
        else if(req.url.includes("/pagerduty")){
            req.on('end', async function () {
                console.debug('sucessfully received pagerduty webhook from pagerduty');
                post = JSON.parse(body);
                if(post.messages){
                    for (var i = 0; i < post.messages.length; i++) {
                        var message = post.messages[i];
                        // console.log(message);
                        if(message['event'] == 'incident.acknowledge'){
                            console.debug('incident acknowledgement.');
                            onIncidentAcknowledgement(message);
                        } else if(message['event'] == 'incident.resolve') {
                            console.debug('incident resolved.');
                            onIncidentManagerResolved(message);
                        }
                    }
                }
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.write(JSON.stringify({
                    text: "OK"
                }));
                res.end();
            });
        }
        else {
            req.on('end', async function () {
                post = qs.parse(body);
                verifySlackWebhook(post);

                var incidentChannelId = await createIncidentFlow(post);
                console.log('Successful execution of incident flow');
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.write(JSON.stringify({
                    text: "Incident management process started. Join incident channel: slack://channel?team=" + process.env.SLACK_TEAM_ID + "&id=" + incidentChannelId,
                    incident_channel_id: incidentChannelId
                }));
                res.end();
            });
        }
    } catch (error) {
        console.log(error);

        res.writeHead((error.code ? error.code : 500), {'Content-Type': 'application/json'});
        res.write(JSON.stringify({response_type: "in_channel", text: error.message}));
        res.end();
    }
}).listen(process.env.PORT ? process.env.PORT : 8080);
console.log('Server listening on port ' + (process.env.PORT ? process.env.PORT : 8080));
