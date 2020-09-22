const axios = require('axios');

const gSuiteClient = axios.create({
  baseURL: "http://localhost:3000",
  headers: {
  //   Authorization: "Bearer EXAMPLE_CODE"
    "Content-Type": "application/json"
  }
})

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

const addUserToGroup = async (email) => {
  const response = await gSuiteClient.post(`/members/`, { email });
  return response.data;
}


const getGroupMembers = async (groupKey) => {
  const response = await gSuiteClient.get(`/members/`);
  return response.data;
}

const removeUserFromGroup = async (memberKey) => {
  console.log(`Remove ${memberKey}.`)
  const response = await gSuiteClient.delete(`/members/${memberKey}`);
  console.log(response);
}


const clearGroupMembers = async () => {
  return await gSuiteClient.delete(`/members/${memberKey}`);
}


module.exports = {
  addUserToGroup,
  getGroupMembers,
  createIncidentsLogFile,
  registerIncidentEvent,
  removeUserFromGroup,
  clearGroupMembers,
}
