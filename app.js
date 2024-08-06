require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
const port = 5001;
const NodeCache = require('node-cache');

const responseCache = new NodeCache({ stdTTL: 14400 });


let accessToken = null;
let tokenCache = {
    accessToken: null,
    expiryTime: null
};


const fetchAzureToken = async () => {
    const currentTime = new Date().getTime();

    // Check if we have a valid token in the cache
    if (tokenCache.accessToken && tokenCache.expiryTime > currentTime) {
            console.log("******tokenfound*****")
        return tokenCache.accessToken;
    }

    // If no valid token, fetch a new one
    const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/token`;
    const resource = 'https://management.azure.com';
    try {
        const response = await axios.post(tokenUrl, `grant_type=client_credentials&client_id=${process.env.CLIENT_ID}&client_secret=${process.env.CLIENT_SECRET}&resource=${resource}`, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
            console.log(response);

        // Update the cache with the new token and expiry time
        tokenCache.accessToken = response.data.access_token;
        // Assuming the expiry is returned in seconds (convert it to milliseconds)
        tokenCache.expiryTime = currentTime + response.data.expires_in * 1000;

        console.log(tokenCache.accessToken);

        return tokenCache.accessToken;
    } catch (error) {
        console.error('Error fetching Azure token:', error);
        throw error;
    }
};
const fetchDataForSubscription = async (subscriptionId, accessToken) => {
    const baseUrl = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2019-11-01`;

    const commonData = {
        "type": "Usage",
        "timeframe": "ThisMonth",
        "dataSet": {
            "granularity": "Monthly",
            "aggregation": {
                "totalCost": { "name": "Cost", "function": "Sum" }
            }
        }
    };

    const monthlyCostData = await axios.post(
        baseUrl,
        {
            "type": "Usage",
            "timeframe": "ThisMonth",
            "dataSet": {
                "granularity": "Monthly",
                "aggregation": {
                    "totalCost": {
                        "name": "Cost",
                        "function": "Sum"
                    }
                }, "grouping": [
                    {
                        "type": "Dimension",
                        "name": "ServiceName"
                    },
                    {
                        "type": "Dimension",
                        "name": "Resourcegroupname"
                    }
                ]
            }
        },
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        }
    );

    const resourceGroupWiseData = await axios.post(
        baseUrl,
        {
            "type": "Usage",
            "timeframe": "ThisMonth",
            "dataSet": {
                "granularity": "Monthly",
                "aggregation": {
                    "totalCost": {
                        "name": "Cost",
                        "function": "Sum"
                    }
                }, "grouping": [

                    {
                        "type": "Dimension",
                        "name": "Resourcegroupname"
                    }
                ]
            }
        },
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        }
    );
    const dates = getDatesForLast7Days();
    const last7DaysData = await axios.post(baseUrl, { "type": "Usage", "timeframe": "Custom", "timePeriod": { "from": dates.startDate, "to": dates.endDate }, "dataSet": commonData.dataSet }, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    const todayDate = getTodayDate();
    const todayData = await axios.post(baseUrl, { "type": "Usage", "timeframe": "Custom", "timePeriod": { "from": todayDate, "to": todayDate }, "dataSet": commonData.dataSet }, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    console.log(resourceGroupWiseData.data)

    return {
        thisMonth: monthlyCostData.data,
        last7days: last7DaysData.data,
        resourceGroupWise: resourceGroupWiseData.data,
        today: todayData.data
    };
};

const getDatesForLast7Days = () => {
    const endDate = new Date();
    endDate.setDate(endDate.getDate());
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    const formatAsDate = date => `${date.getFullYear()}-${(`0${date.getMonth() + 1}`).slice(-2)}-${(`0${date.getDate()}`).slice(-2)}`;
    return { startDate: formatAsDate(startDate), endDate: formatAsDate(endDate) };
};
const getTodayDate = () => {
    const today = new Date();
    const formatAsDate = date => `${date.getFullYear()}-${(`0${date.getMonth() + 1}`).slice(-2)}-${(`0${date.getDate()}`).slice(-2)}`;
    return formatAsDate(today);
};
app.get('/:subscriptionName', async (req, res) => {
    const subscriptionName = req.params.subscriptionName;
    try {

        const cachedData = responseCache.get(subscriptionName);
        if (cachedData) {
            console.log('******Serving from cache*******');
            return res.json(cachedData);
        }
        const accessToken = await fetchAzureToken();
        console.log(accessToken)
        const subscriptionId = process.env[req.params.subscriptionName];
        const data = await fetchDataForSubscription(subscriptionId, accessToken);
        res.json(data);
        responseCache.set(subscriptionName, data);

    } catch (error) {
        console.error('Error fetching Azure cost data:', error);
        res.status(500).send('Error fetching Azure cost data');
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
