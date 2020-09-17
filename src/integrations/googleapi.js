const {google} = require('googleapis');
const moment = require('moment');

function getoAuth2Client(){
  if(!process.env.GOOGLEAPI_CLIENT_ID || !process.env.GOOGLEAPI_CLIENT_SECRET || !process.env.GOOGLE_AUTHORIZATION_TOKEN){
    console.log('GOOGLEAPI_CLIENT_ID, GOOGLE_AUTHORIZATION_TOKEN or GOOGLEAPI_CLIENT_SECRET not provided. Calendar/Conference details wont be provided');
    return;
  }
  var client_secret = process.env.GOOGLEAPI_CLIENT_SECRET;
  var client_id = process.env.GOOGLEAPI_CLIENT_ID;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'urn:ietf:wg:oauth:2.0:oob');
  var token = JSON.parse(process.env.GOOGLE_AUTHORIZATION_TOKEN);
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

const createIncidentsLogFile = (fileName, folder, incidentTitle, reportedBy, onSuccess) => {
  const oAuth2Client = getoAuth2Client();
  if(!oAuth2Client){
    return;
  }

  const drive = google.drive({version: 'v3', auth: oAuth2Client});
  var metadata = {
    "mimeType": "application/vnd.google-apps.document",
    "name":fileName
  };
  if(folder){
    metadata['parents'] = [folder];
  }
  drive.files.create({
    resource:metadata,
    "fields": 'id',
  }, (err, res) => {
    if (err) return console.log('The API returned an error: ' + err);

    var documentUrl = 'https://docs.google.com/document/d/'+res.data.id;
    //Call on success callback
    onSuccess(documentUrl);
    const docs = google.docs({version: 'v1', auth: oAuth2Client});
    var now = moment.utc();

    var inicidentTitleLength = incidentTitle.length;
    //console.log(res);
    //docs.documents.move()
    var texts = [
      {
        text: incidentTitle + "\n",
        style: {
          "updateParagraphStyle":{
            paragraphStyle:{
              namedStyleType:"TITLE"
            },
            fields:'namedStyleType'
          }
        }
      },
      {
        text: "Quick description of the problem\n",
        style: {
            "updateParagraphStyle":{
              paragraphStyle:{
                namedStyleType:"HEADING_1"
              },
              fields:'namedStyleType'
            }
          },
      },
      {
        text: "\n",
      },
      {
        text:"Timeline\n",
        style: {
          "updateParagraphStyle":{
            paragraphStyle:{
              namedStyleType:"HEADING_1"
            },
            fields:'namedStyleType'
          }
        },
      },
      {
        text: "Times in UTC\n\n",
        style: {
          "updateTextStyle":{
            textStyle:{
              italic:true
            },
            fields:'italic'
          }
        }
      },
      {
        text: now.format("YYYY-MM-DD HH:mm Z") + ": Incident started by " + reportedBy + "\n\n"
      },
      {
        text:"[Copy & paste data]\n",
        style:  {
          "updateParagraphStyle":{
            paragraphStyle:{
              namedStyleType:"HEADING_1"
            },
            fields:'namedStyleType'
          }
        },
      },
      {
        text: "\n\n"
      }
    ];

    var requests = [];
    var index = 1;
    for(var i=0;i<texts.length;i++){
      var text = texts[i].text;
       requests.push(
        {
          "insertText":{
            "text": text,
            location:{
              "index":index
            }
          }
        }
       );
       if(texts[i].style){
         var style = texts[i].style;
         style[Object.keys(style)[0]]['range'] = {
          startIndex:index,
          endIndex: index + text.length
        };
        requests.push(texts[i].style);
       }
       index = index + text.length;
    }

    setTimeout(
    function(){docs.documents.batchUpdate({
      documentId: res.data.id,
      resource:{
        "requests": requests
      }
    },(err, res) =>{
      if (err){
        console.log("Error writing to file: " + err);
      }
    }
    )},1000);;


  });
}

/**
 * Create an OAuth2 client with the given credentials
 * @param {Object} credentials The authorization client credentials.
 */
const registerIncidentEvent = (incidentId, incidentName, reportedBy, slackChannel, onSuccess) => {
    const oAuth2Client = getoAuth2Client();
    if(!oAuth2Client){
      return;
    }
    var now = moment();
    var eventDescription = "<b>"+incidentName+"</b>\n"+
                              "<small>" +
                              "Incident response triggered on " + now.format("DD/MM/YYYY HH:mm") + "\n" +
                              "Reported by " + reportedBy + "\n" +
                              (slackChannel?"<a href='https://slack.com/app_redirect?channel=" + slackChannel+ "'>Incident Slack Channel</a>\n":'')+
                              "</small>";

    createEvent(oAuth2Client, incidentName, incidentId, eventDescription, onSuccess);
}

function createEvent(auth, incidentName, incidentId, incidentDescription, onSuccess){
  const calendar = google.calendar({version: 'v3', auth});
  var calendarId = process.env.GOOGLE_CALENDAR_ID;
  if(!calendarId){
    calendarId = 'primary';
  }
  var calendarTimezone = process.env.GOOGLE_CALENDAR_TIMEZONE;
  if(!calendarTimezone){
    calendarTimezone = 'Europe/Amsterdam';
  }
  var start = new Date ();
  var end = new Date ( start );
  end.setMinutes ( start.getMinutes() + 5 );

  var event = {
    'summary': incidentName,
    'description': incidentDescription,
    'start': {
      'dateTime': start.toISOString(),
      'timeZone': calendarTimezone,
    },
    'end': {
      'dateTime': end.toISOString(),
      'timeZone': calendarTimezone,
    },
  };

  var eventCreated;
  calendar.events.insert({
    auth: auth,
    calendarId: calendarId,
    resource: event,
  }, function(err, event) {
        if (err) {
          console.log('There was an error contacting the Calendar service: ' + err);
          return;
        }

        var eventPatch = {
          conferenceData: {
            createRequest: {requestId: incidentId},
          },
        };

        calendar.events.patch({
          calendarId: calendarId,
          eventId: event.data.id,
          resource: eventPatch,
          sendNotifications: true,
          conferenceDataVersion: 1
        }, function(err, event) {
            if(err){
              console.log('There was an error adding the conference details');
            }
            else{
              onSuccess(event);
            }
          }
        );
  });
}


const addUserToGroup = async (groupKey, userEmail) => {
  console.log('Adding ' + userEmail + ' to firefighters group.');
  const auth = getoAuth2Client();
  const groupsAPI = await google.admin('directory_v1');

  const response = await groupsAPI.members.insert({
    groupKey,
    auth,
    requestBody: {
      email: userEmail,
      role: "MEMBER",
    }
  });
  return response.data;
}


const getGroupMembers = async (groupKey) => {
  const auth = getoAuth2Client();
  const groupsAPI = await google.admin('directory_v1');

  const response = await groupsAPI.members.list({
    groupKey,
    auth,
  });
  return response.data?.members || [];
}


const removeUserFromGroup = async (groupKey, memberKey) => {
  console.log(groupKey, memberKey);
  const auth = getoAuth2Client();
  const groupsAPI = await google.admin('directory_v1');

  const response = await groupsAPI.members.delete({
    groupKey,
    memberKey,
    auth,
  });

  return response.status == 204;
}


const clearGroupMembers = async (groupKey) => {
  const auth = getoAuth2Client();

  const groupsAPI = await google.admin('directory_v1');
  const response = await groupsAPI.members.list({
      groupKey,
      auth,
  });

  (response.data.members || []).map((member) => {
    removeUserFromGroup(groupKey, member.email);
  });
}


module.exports = {
  addUserToGroup,
  getGroupMembers,
  createIncidentsLogFile,
  registerIncidentEvent,
  removeUserFromGroup,
  clearGroupMembers,
}
