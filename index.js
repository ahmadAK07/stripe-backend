import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config();

const PORT = process.env.PORT || 5000;
const stripe = Stripe(process.env.STRIPE_SK);

const app = express();
app.use(cors());


// This is your Stripe CLI webhook secret for testing your endpoint locally.
const endpointSecret = process.env.WEBHOOK_SECRET;

app.post('/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
    const sig = request.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
    } catch (err) {
        response.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    switch (event.type) {
        case "invoice.payment_failed": {
            const invoiceFailed = event.data.object;
            const customerId = invoiceFailed.customer;

            // Default metadata structure
            const defaultMetadata = {
                customerId: customerId,
                isSubscribed: 'false',
                activePlan: "free",
                subscriptionId: null,
            };

            // Update the customer's metadata to default values
            await stripe.customers.update(customerId, {
                metadata: defaultMetadata,
            });

            break;
        }
        case "invoice.payment_succeeded": {
            const invoiceSucceeded = event.data.object;
            const subscriptionId = invoiceSucceeded.subscription;
            const customerId = invoiceSucceeded.customer;

            // Retrieve the subscription to get the price ID
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const priceId = subscription.items.data[0].price.id;

            

            // Default metadata structure
            let updatedMetadata = {
                customerId,
                isSubscribed: 'true',
                activePlan: "free",
                subscriptionId: subscriptionId,
            };

            // Switch case based on the price ID
            switch (priceId) {
                case process.env.MONTH:
                    updatedMetadata = {
                        ...updatedMetadata,
                        activePlan: `Monthly`,
                    };
                    break;
                default:
                    // If the price ID does not match any of the known packages, do not change the metadata
                    break;
            }

            // Update the customer's metadata in Stripe
            await stripe.customers.update(customerId, {
                metadata: updatedMetadata,
            });

            break;
        }

        case "customer.subscription.deleted": {
            const subscription = event.data.object;
            const customerId = subscription.customer;

            // Default metadata structure
            const defaultMetadata = {
                customerId,
                isSubscribed: 'false',
                activePlan: "free",
                subscriptionId: null,
            };

            // Update the customer's metadata to default values
            await stripe.customers.update(customerId, {
                metadata: defaultMetadata,
            });

            break;
        }

        

        default: {
            // Return a 200 response to acknowledge receipt of the event
            response.status(200).send('Received');
        }
    }

    // Return a 200 response to acknowledge receipt of the event
    response.send();
});
app.use(express.json());

function formatUnixTimestamp(timestamp) {
    // Create a new Date object from the UNIX timestamp
    const date = new Date(timestamp * 1000);

    // Define options for formatting
    const options = {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true // This ensures AM/PM format
    };

    // Use toLocaleString to format the date and time
    const formattedDate = date.toLocaleString('en-GB', options);

    // Reformat to the desired output
    const [datePart, timePart] = formattedDate.split(', ');
    const [day, month, year] = datePart.split('/');
    const [time, period] = timePart.split(' ');

    return `${day}/${month}/${year} ${time} ${period}`;
}
const handleCustomerSubscription = async (email) => {
    try {
        // Step 1: Retrieve or create customer by email
        const customers = await stripe.customers.list({ email: email, limit: 1 });

        let customer;
        if (customers.data.length > 0) {
            customer = customers.data[0];
        } else {
            customer = await stripe.customers.create({ email: email });
        }

        // Step 2: Check for any active subscriptions
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active',
            limit: 1,
        });

        // Step 3: Define default metadata
        const defaultMetadata = {
            
            customerId: customer.id,
            
            isSubscribed: 'false',
            activePlan: "free",
            subscriptionId: null,
        };

        

        if (Object.keys(customer.metadata).length === 0) {
            // If metadata is empty, apply the default metadata
            await stripe.customers.update(customer.id, {
                metadata: defaultMetadata,
            });
        }

        // Step 5: Return subscription status and updated metadata
        if (subscriptions.data.length > 0) {
            // Active subscription found
            return { subscription: true, metadata: customer.metadata };
        } else {
            // No active subscription
            return { subscription: false, metadata: customer.metadata };
        }
    } catch (error) {
        console.error('Error handling customer subscription:', error);
        throw error; // Rethrow the error after logging it
    }
};


async function createCheckoutSession(customerId, priceId) {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            customer: customerId,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: process.env.SUCCESS_URL,
            cancel_url: process.env.CANCEL_URL,
        });

        return {
            success: true,
            url: session.url,
        };
    } catch (error) {
        console.error('Error creating checkout session:', error);
        return {
            success: false,
            message: error.message,
        };
    }
}

async function cancelSubscription(subscriptionId) {
    try {
        const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
        });
        console.log(`Subscription with ID ${subscriptionId} will be canceled at ${formatUnixTimestamp(updatedSubscription.canceled_at)}.`);
        return {
            message: `Subscription with ID ${subscriptionId} will be canceled at ${formatUnixTimestamp(updatedSubscription.cancel_at)}.`,
            updatedSubscription

        }
    } catch (error) {
        console.error(`Failed to set cancellation for subscription: ${error.message}`);
        throw error;
    }
}


app.post('/get-subscription',async(req, res)=>{
    try{
        const {email} =req.body;
        const data = await handleCustomerSubscription(email);
        res.send(data);

    }catch (error){
        res.send(error.message);
    }
});

app.post('/create-subscription',async(req, res)=>{
    try{
        const { priceId,customerId } = req.body;
        const data = await createCheckoutSession(customerId,priceId);
        res.send(data);

    }catch (error){
        res.send(error.message);
    }
});

app.post('/cancel-subscription',async(req, res)=>{
    try{
        const { subscriptionId } = req.body;
        const data = await cancelSubscription(subscriptionId);
        res.send(data);

    }catch (error){
        res.send(error.message);
    }
});


import path from "path";
app.get('/', async (req, res) => {
    res.json({
        message: `Server is running at ${PORT}`
    });
});
app.get("/success", (req, res) => {
  res.sendFile(path.join(__dirname, "success.html"));
});
app.get("/cancel", (req, res) => {
  res.sendFile(path.join(__dirname, "success.html"));
});
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
