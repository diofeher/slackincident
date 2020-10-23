const axios = require('axios');


const gSuiteClient = axios.create({
  baseURL: process.env.GSUITE_SERVICE_URL,
  headers: {
    "Authorization-Token": process.env.GSUITE_SERVICE_TOKEN,
    "Content-Type": "application/json"
  },
});

gSuiteClient.interceptors.response.use(function (response) {
  const { data, config: { url, method }} = response;

  if(!data.ok) {
      console.error(url, method, data);
  }
  return response;
}, function (error) {
  const { config, response } = error;
  console.log(`[-] Error when requesting ${config.url}!`);
  console.log(`[-] Response ${response.status}: ${JSON.stringify(response.data)}!`);
  return Promise.reject(error);
});


const createIncidentsLogFile = async (fileName, folder, incidentTitle, reportedBy) => {
  return await gSuiteClient.post(`/incidents/log`, {
    fileName,
    folder,
    incidentTitle,
    reportedBy,
  });
}

const registerIncidentEvent = async (incidentId, incidentName, reportedBy, slackChannel) => {
  return await gSuiteClient.post(`/incidents/`, {
    incidentId,
    incidentName,
    reportedBy,
    slackChannel
  });
}

const addUserToGroup = async (email, admin) => {
  const { data } = await gSuiteClient.post(`/members/`, { email, admin });
  return data;
}


const getGroupMembers = async (groupKey) => {
  const { data } = await gSuiteClient.get(`/members/`);
  return data;
}

const removeUserFromGroup = async (memberKey) => {
  console.debug(`Remove ${memberKey}.`)
  return await gSuiteClient.delete(`/members/${memberKey}`);
}


const clearGroupMembers = async () => {
  console.debug(`Clearing group members.`)
  return await gSuiteClient.delete('/members/');
}


module.exports = {
  addUserToGroup,
  getGroupMembers,
  createIncidentsLogFile,
  registerIncidentEvent,
  removeUserFromGroup,
  clearGroupMembers,
}
