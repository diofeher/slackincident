const slack = require('./integrations/slack');
const pagerduty = require('./integrations/pagerduty');
const googleapi = require('./integrations/googleapi');
const moment = require('moment');
const jira = require('./integrations/jira');
const config = require('./config');


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


const createIncidentFlow = async (body, isPrivate) => {
    const incidentId = moment().format('YYYYMMDDHHmmss');
    const incidentName = body.text;
    const incidentCreatorSlackHandle = body.user_name;
    const incidentCreatorSlackUserId = body.user_id;

    const prefix = isPrivate ? process.env.SLACK_SECURITY_INCIDENT_CHANNEL_PREFIX : process.env.SLACK_INCIDENT_CHANNEL_PREFIX;

    const incidentSlackChannel = `${prefix}${incidentId}` || incidentSlackChannel;

    const incidentSlackChannelID = await slack.createSlackChannel(incidentName, incidentCreatorSlackUserId, incidentSlackChannel, isPrivate);

    pagerduty.alertIncidentManager(incidentName, incidentSlackChannelID, incidentCreatorSlackHandle, isPrivate);

    try {
        createGoogleResources(incidentId, incidentName, incidentSlackChannelID, incidentSlackChannel, incidentCreatorSlackHandle, isPrivate);
    } catch(err) {
        console.error('Error when creating Google Resources', err.message);
    }

    try {
        createJIRATicket(incidentId, incidentName, incidentSlackChannelID, incidentSlackChannel, incidentCreatorSlackHandle, isPrivate);
    } catch(err) {
        console.error('Error when creating JIRA and notifying', err.message);
    }

    return incidentSlackChannelID;
}


const createGoogleResources = async (id, name, channelId, channel, creator, isPrivate) => {
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
}

const createJIRATicket = async (id, name, channelId, channel, creator, isPrivate) => {
    jira.createFollowupsEpic(id, name, channelId, channel);

    // Return a formatted message
    var slackMessage = slack.createInitialMessage(name, creator, channel, channelId);

    if(process.env.SLACK_INCIDENTS_CHANNEL && !isPrivate){
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
            {color: config.COLORS.GREEN, text: `Controlled burning. Incident Resolved.`}
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
    return incidentChannelId;
}

const createPrivateFlow = async(req, res) => {
    const channel = await createFlow(req, res, true);
    const managers = config.INCIDENT.SECURITY_MANAGERS;
    await slack.inviteUser(channel, managers);
}


module.exports = {
    createFlow,
    createPrivateFlow,
    onIncidentManagerResolved,
    createIncidentFlow,
    removeInactiveIncidentMembers,
    sendIncidentLogFileToChannel,
}
