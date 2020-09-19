const request = require('request');
const slack = require('./slack');
const googleapi = require('./googleapi');
const rp = require('request-promise');


class NotFound extends Error {
    constructor(message, cause) {
      super(message);
      this.cause = cause;
      this.name = 'NotFound';
    }
  }


const getActiveIncidents = async () => {
    const response = await rp.get({
        url: 'https://api.pagerduty.com/incidents?statuses[]=triggered&total=true',
        headers: {
            'Authorization': 'Token token=' + process.env.PAGERDUTY_READ_ONLY_API_KEY
        },
    });
    return JSON.parse(response);
}

const getIncidentBySlackChannel = async (slackChannelID) => {
    const activeIncidents = await getActiveIncidents();
    const filteredIncidents = await Promise.all(
        (activeIncidents.incidents || []).filter(async (incident) => {
            const details = await getIncidentDetails(incident.id);
            return slackChannelID == details.slack_channel;
        })
    );

    if(filteredIncidents.length > 0) {
        return filteredIncidents[0];
    } else {
        throw new NotFound();
    }
}

const getTotalActiveIncidents = async () => {
    return await getActiveIncidents().total;
}

const getIncidentDetails = async (incidentID) => {
    var headers = {
        'Authorization': 'Token token='+ process.env.PAGERDUTY_READ_ONLY_API_KEY
    };

    const response = await rp.get({
        url: `https://api.pagerduty.com/incidents/${incidentID}/alerts`,
        headers,
    });

    var alerts = JSON.parse(response)["alerts"];
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

        var auth_header = {
            'Authorization': 'Token token='+ process.env.PAGERDUTY_READ_ONLY_API_KEY
        };

        //get alerts for the incident to get additional details for the incident
        request.get({
            url: pagerduty_incident_ref_url + "/alerts",
            headers: auth_header
        },
        async function (error, response, body) {
            if(error){
                console.log(error);
            }
            else{
                console.log(pagerduty_incident_ref_url, 'hello', body, response.statusCode);
                var alerts = JSON.parse(body)["alerts"];
                var alert = alerts[0];
                var alert_details = alert["body"]["details"];
                var slack_channel = alert_details["slack_channel"];
                if(slack_channel){
                    slack.sendIncidentManagerJoiningSoonMessageToChannel(slack_channel, agent["summary"])
                }
                const imEmail = await getIncidentManagerEmail(pagerduty_user_ref_url);
                googleapi.addUserToGroup(process.env.GSUITE_GROUP_KEY, imEmail);
            }
        })
    }
}


const getIncidentManagerEmail = async (userURL) => {
    const respUser = await rp.get({
        url: userURL,
        headers: {
            'Authorization': 'Token token=' + process.env.PAGERDUTY_READ_ONLY_API_KEY
        },
    });
    return JSON.parse(respUser).user.email;
}


function alertIncidentManager(incidentName, incidentSlackChannelID, incidentCreatorSlackHandle) {
    if(process.env.DRY_RUN){
        console.log('DRY_RUN: Creating incident!');
        return;
    }
    if(process.env.PAGERDUTY_API_TOKEN){
        request.post({
            url: "https://events.pagerduty.com/v2/enqueue",
            json: {
                "routing_key": process.env.PAGERDUTY_API_TOKEN,
                "event_action": "trigger",
                "payload": {
                    "summary": "New incident '" + incidentName + "' created by @" + incidentCreatorSlackHandle,
                    "source": incidentSlackChannelID,
                    "severity": "critical",
                    "custom_details": {
                        "slack_deep_link_url": "https://slack.com/app_redirect?team=" + process.env.SLACK_TEAM_ID + "&channel=" + incidentSlackChannelID,
                        "slack_deep_link": "slack://channel?team=" + process.env.SLACK_TEAM_ID + "&id=" + incidentSlackChannelID,
                        "initiated_by": incidentCreatorSlackHandle,
                        "slack_channel": incidentSlackChannelID
                    }
                },
            }
        })
    }
    if(process.env.OPSGENIE_API_KEY){
        request.post({
            url: process.env.OPSGENIE_URL + "/v1/incidents/create",
            headers: {
                'Authorization': 'GenieKey '+process.env.OPSGENIE_API_KEY
            },
            json: {
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
            }
        },
        function (error, response, body) {
            if(error){
                console.log(error);
            }
            else{
                console.log("Opsgenie incident started!");
            }
        })
    }
}


module.exports = {
    getIncidentBySlackChannel,
    getIncidentDetails,
    getTotalActiveIncidents,
    getIncidentManagerEmail,
    alertIncidentManager,
    onIncidentManagerAcknowledge,
    onIncidentManagerResolved,
}
