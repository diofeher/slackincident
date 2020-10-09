const slack = require('./slack');
const axios = require('axios');
const googleapi = require('./googleapi');


class NotFound extends Error {
    constructor(message, cause) {
      super(message);
      this.cause = cause;
      this.name = 'NotFound';
    }
}

const pagerDutyClient = axios.create({
    baseURL: "https://api.pagerduty.com",
    headers: {
        Authorization: 'Token token=' + process.env.PAGERDUTY_READ_ONLY_API_KEY,
        "Content-Type": "application/json"
    }
  })


const getActiveIncidents = async () => {
    const { data } = await pagerDutyClient.get('/incidents?statuses[]=triggered&statuses[]=acknowledged&total=true');
    return data;
}

const asyncFilter = async (arr, predicate) => {
    const results = await Promise.all(arr.map(predicate));
    return arr.filter((_v, index) => results[index]);
};

const getIncidentBySlackChannel = async (channelId) => {
    const { incidents: activeIncidents } = await getActiveIncidents();

    const filteredIncidents = await asyncFilter(activeIncidents || [], async (incident) => {
        const details = await getIncidentDetails(incident.id);
        return channelId == details.slack_channel;
    });

    if(filteredIncidents.length > 0) {
        return filteredIncidents[0];
    } else {
        throw new NotFound();
    }
}

const getTotalActiveIncidents = async () => {
    return (await getActiveIncidents()).total;
}

const getIncidentDetails = async (incidentID) => {
    const { data } = await pagerDutyClient.get(`/incidents/${incidentID}/alerts`);

    var alerts = data.alerts;
    var alert = alerts[0];
    return alert["body"]["details"];
}


const onIncidentManagerResolved = async (message) => {
    var log_entry = message["log_entries"][0];//As defined in the doc, there will be only one log entry for incident.acknowledge event
    var agent = log_entry["agent"];
    var pagerduty_user_ref_url = agent["self"];
    return await getIncidentManagerEmail(pagerduty_user_ref_url);
}

/**
 *
 * This message will be called when the webhook coming from pagerduty arrives that indicates the Incident Manager has acknowledge an alert
 *
 * @param {0} message - Message object for the acknowledge event as describe here: https://developer.pagerduty.com/docs/webhooks/v2-overview/#webhook-payload
 */
const onIncidentManagerAcknowledge = async (message) => {
    if(process.env.PAGERDUTY_READ_ONLY_API_KEY){
        var log_entry = message["log_entries"][0];//As defined in the doc, there will be only one log entry for incident.acknowledge event
        var service = log_entry["service"];
        // if(service["id"] != process.env.PAGERDUTY_INCIDENT_MANAGERS_SERVICE_ID){
        //     return
        // }
        var agent = log_entry["agent"];
        var pagerduty_user_ref_url = agent["self"];
        var incident = log_entry["incident"];
        var pagerduty_incident_ref_url = incident["self"];

        //get alerts for the incident to get additional details for the incident
        const response = await pagerDutyClient.get(pagerduty_incident_ref_url + "/alerts");
        var alerts = response.data["alerts"];
        var alert = alerts[0];
        var alert_details = alert["body"]["details"];
        var slack_channel = alert_details["slack_channel"];
        if(slack_channel){
            slack.sendIncidentManagerJoiningSoonMessageToChannel(slack_channel, agent["summary"])
        }
        const imEmail = await getIncidentManagerEmail(pagerduty_user_ref_url);
        googleapi.addUserToGroup(imEmail, true);
    }
}


const getIncidentManagerEmail = async (userURL) => {
    const { data: { user } } = await pagerDutyClient.get(userURL);
    return user.email;
}


const alertIncidentManager = async (incidentName, incidentSlackChannelID, incidentCreatorSlackHandle) => {
    console.log('alertIncidentManager:starting');
    if(process.env.DRY_RUN){
        console.log('DRY_RUN: Creating incident!');
        return;
    }
    if(process.env.PAGERDUTY_API_TOKEN){
        axios.post("https://events.pagerduty.com/v2/enqueue", {
            "routing_key": process.env.PAGERDUTY_API_TOKEN,
            "event_action": "trigger",
            "payload": {
                summary: "New incident '" + incidentName + "' created by @" + incidentCreatorSlackHandle,
                source: incidentSlackChannelID,
                severity: "critical",
                "custom_details": {
                    "slack_deep_link_url": "https://slack.com/app_redirect?team=" + process.env.SLACK_TEAM_ID + "&channel=" + incidentSlackChannelID,
                    "slack_deep_link": "slack://channel?team=" + process.env.SLACK_TEAM_ID + "&id=" + incidentSlackChannelID,
                    "initiated_by": incidentCreatorSlackHandle,
                    "slack_channel": incidentSlackChannelID
                }
            },
        });
        console.log('alertIncidentManager:end');
    }
    if(process.env.OPSGENIE_API_KEY){
        await axios.post(`${process.env.OPSGENIE_URL}/v1/incidents/create`, {
            "message": incidentName,
            "description": "New incident '" + incidentName + "' created by @" + incidentCreatorSlackHandle,
            "priority":"P1",
            "responders":[
                {"id": process.env.OPSGENIE_INCIDENT_MANAGER_TEAM_ID ,"type":"team"}
            ],
            "details": {
                "slack_deep_link_url": "https://slack.com/app_redirect?team=" + process.env.SLACK_TEAM_ID + "&channel=" + incidentSlackChannelID,
                "slack_deep_link": "slack://channel?team=" + process.env.SLACK_TEAM_ID + "&id=" + incidentSlackChannelID,
                "initiated_by": incidentCreatorSlackHandle,
                "slack_channel": incidentSlackChannelID
            }
        }, {
            headers: {
                'Authorization': `GenieKey ${process.env.OPSGENIE_API_KEY}`,
            }
        });
        console.log("Opsgenie incident started!");
    }
}


module.exports = {
    getActiveIncidents,
    getIncidentBySlackChannel,
    getIncidentDetails,
    getTotalActiveIncidents,
    getIncidentManagerEmail,
    alertIncidentManager,
    onIncidentManagerAcknowledge,
    onIncidentManagerResolved,
}
