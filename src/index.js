'use strict';

const http = require('http');
const qs = require('querystring');
const moment = require('moment');

const googleapi = require('./integrations/googleapi');
const pagerduty = require('./integrations/pagerduty');
const slack = require('./integrations/slack');
const jira = require('./integrations/jira');
const { onBreakGlass } = require('./break-glass');
const { COLORS } = require('./config');


const removeInactiveIncidentMembers = async (channelID) => {
    const { incidents: activeIncidents } = await pagerduty.getActiveIncidents();

    var detailedIncidents = await Promise.all(activeIncidents.map(async (incident) => {
        const details = await pagerduty.getIncidentDetails(incident.id);
        const members = await slack.getMembersChannel(details.slack_channel);
        return members || [];
    }));

    const membersActiveIncidents = [...new Set(detailedIncidents.flat())];
    const activeMembers = await slack.getMembersChannel(channelID);

    (activeMembers || []).map(async (member) => {
        if(!membersActiveIncidents.includes(member)) {
            const { email } = await slack.getProfileInfo(member);
            console.log(`Removing ${email}`);
            email && googleapi.removeUserFromGroup(email);
        };
    });
}

function sendIncidentLogFileToChannel(channelId, docUrl) {
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
    slack.sendSlackMessageToChannel(channelId, slackMessage);
}

function verifySlackWebhook(body) {
    if (!body || body.token !== process.env.SLACK_COMMAND_TOKEN) {
        const error = new Error('Invalid credentials');
        error.code = 400;
        throw error;
    }
}

const createIncidentFlow = async (body, isPrivate) => {
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

    var incidentSlackChannelID = await slack.createSlackChannel(incidentName, incidentCreatorSlackUserId, incidentSlackChannel, isPrivate);

    pagerduty.alertIncidentManager(incidentName, incidentSlackChannelID, incidentCreatorSlackHandle);
    createAdditionalResources(incidentId, incidentName, incidentSlackChannelID, incidentSlackChannel, incidentCreatorSlackHandle);

    return incidentSlackChannelID;
}


const createAdditionalResources = async (id, name, channelId, channel, creator) => {
    const { data: {event: eventDetails} } = await googleapi.registerIncidentEvent(id,
        name,
        creator,
        channel,
    );

    slack.sendConferenceCallDetailsToChannel(channelId, eventDetails);

    var fileName = channel;
    const { data: { documentUrl } } = await googleapi.createIncidentsLogFile(fileName,
        process.env.GDRIVE_INCIDENT_NOTES_FOLDER,
        name,
        creator,
    );

    sendIncidentLogFileToChannel(channelId, documentUrl);

    jira.createFollowupsEpic(name, channelId, channel);
    console.log('Created JIRA Follows up');

    // Return a formatted message
    var slackMessage = slack.createInitialMessage(name, creator, channel, channelId);

    if(process.env.SLACK_INCIDENTS_CHANNEL){
        var channelsToNotify = process.env.SLACK_INCIDENTS_CHANNEL.split(",");
        for(var i=0;i < channelsToNotify.length;i++){
            await slack.sendSlackMessageToChannel(channelsToNotify[i], slackMessage);
        }
    }
}


const onIncidentManagerResolved = async (message) => {
    const details = await pagerduty.getIncidentDetails(message.incident.id);
    const totalActiveEvents = await pagerduty.getTotalActiveIncidents();

    if(totalActiveEvents > 0) {
        console.debug(`Total Incidents more than Zero workflow... ${totalActiveEvents}, on channel ${details.slack_channel}`);
        removeInactiveIncidentMembers(details.slack_channel);
    } else {
        console.debug(`Zero active incidents workflow... ${totalActiveEvents}`);
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

const createFlow = async (req, res, isPrivate) => {
    var incidentChannelId = await createIncidentFlow(req.body, isPrivate);
    console.log('Successful execution of security incident flow');
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({
        text: "Incident management process started. Join incident channel: slack://channel?team=" + process.env.SLACK_TEAM_ID + "&id=" + incidentChannelId,
        incident_channel_id: incidentChannelId
    }));
    res.end();
}

// Main application
var express = require('express');
var bodyParser = require('body-parser');
var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());

app.post('/pagerduty', (req, res) => {
    verifySlackWebhook(req.body);
    console.debug('Sucessfully received pagerduty webhook from pagerduty.');
    post = JSON.parse(req.body);
    if(post.messages){
        for (var i = 0; i < post.messages.length; i++) {
            var message = post.messages[i];
            if(message['event'] == 'incident.acknowledge'){
                console.debug('incident acknowledgement.');
                pagerduty.onIncidentManagerAcknowledge(message);
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

app.post('/break-glass', (req, res) => {
    verifySlackWebhook(req.body);
    onBreakGlass(req.body);
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({
        text: "Hey, we received your request and we are working it..."
    }));
    res.end();
});

app.post('/', async (req, res) => {
    verifySlackWebhook(req.body);
    createFlow(req, res, false);
});

app.post('/security', async (req, res) => {
    verifySlackWebhook(req.body);
    createFlow(req, res, true);
});


app.use(function (err, req, res, next) {
    console.log(err);

    res.writeHead(error.code || 500, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({response_type: "in_channel", text: error.message}));
    res.end();
});

const port = process.env.PORT || 8080;
app.listen(port);
console.log(`Server listening on port ${port}.`);
