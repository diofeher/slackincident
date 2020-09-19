function createPostMortem(incidentName, epicKey, incidentSlackChannelId){

    if(!process.env.POST_MORTEMS_URL){
        return;
    }

    const now = new Date();

    request.post({
        url: process.env.POST_MORTEMS_URL + '/incident/create',
        json: {
            "key" : process.env.POST_MORTEMS_KEY,
            "incident" : {
                "name": incidentName,
                "when": date.format(now, 'YYYY-MM-DD HH:mm:ss'),
                "issueTracking" : "jira:"+epicKey,
                "channel" : "slack:"+incidentSlackChannelId
            }
        }
    },
    function (error, response, body) {
        if (error) {
            console.error(error);
        }
    });
}

function createFollowupsEpic(incidentName, incidentChannelId, incidentSlackChannel) {
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

    request.post({
            url: 'https://' + jiraDomain + '/rest/api/3/issue',
            auth: {
                'user': jiraUser,
                'pass': jiraApiKey
            },
            json: newMessage
        },
        function (error, response, body) {
            if (error) {
                console.error('Sending message to Jira failed:', error);

                throw new Error('Sending message to Jira failed');
            }
            var epicKey = response.body['key'];
            var epicUrl = epicKey ? 'https://' + jiraDomain + '/browse/' + epicKey : '';
            sendEpicToChannel(incidentChannelId, epicUrl);
            createPostMortem(incidentName, epicKey, incidentChannelId)
        });
}

module.exports = {
    createFollowupsEpic,
}
