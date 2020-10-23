const axios = require('axios');
const slack = require('./slack');


const createPostMortem = async (incidentName, epicKey, incidentSlackChannelId) => {
    if(!process.env.POST_MORTEMS_URL){
        return;
    }

    const now = new Date();
    axios.post(process.env.POST_MORTEMS_URL + '/incident/create', {
        key: process.env.POST_MORTEMS_KEY,
        incident: {
            name: incidentName,
            when: date.format(now, 'YYYY-MM-DD HH:mm:ss'),
            issueTracking: `jira: ${epicKey}`,
            channel: `slack: ${incidentSlackChannelId}`
        }
    }).catch((err) => {
        console.log('createPostMortem.error', JSON.stringify(err));
    });
}


const createFollowupsEpic = async(incidentName, incidentChannelId, incidentSlackChannel) => {
    var jiraDomain = process.env.JIRA_DOMAIN;
    //Return if JIRA details are not specified. Assuming checking the domain is enough
    if (!jiraDomain) {
        return
    }

    var jiraUser = process.env.JIRA_USER;
    var jiraApiKey = process.env.JIRA_API_KEY;
    var jiraProjectId = process.env.JIRA_PROJECT_ID;
    var jiraEpicIssueTypeId = process.env.JIRA_ISSUE_TYPE_ID;

    const newMessage = {
        "fields": {
            "issuetype": {
                "id": jiraEpicIssueTypeId
            },
            "project": {
                "id": jiraProjectId
            },
            "summary": incidentName,
            "customfield_10009": incidentSlackChannel,
        }
    };

    const response = await axios.post(`https://${jiraDomain}/rest/api/3/issue`, newMessage, {
        auth: {
            user: jiraUser,
            pass: jiraApiKey
        },
    }).catch((err) => {
        console.log('createFollowupsEpic.error', JSON.stringify(err));
        throw err;
    });

    console.log('Jira Response', JSON.stringify(response));
    var epicKey = response.data['key'];
    var epicUrl = epicKey ? 'https://' + jiraDomain + '/browse/' + epicKey : '';
    slack.sendEpicToChannel(incidentChannelId, epicUrl);
    createPostMortem(incidentName, epicKey, incidentChannelId);
}

module.exports = {
    createFollowupsEpic,
}
