require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Project = require('./models/Project');

async function fix() {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/beagle-udip';
    console.log('Connecting to', uri);
    await mongoose.connect(uri);

    // Find all projects that should be assigned to a client
    // In this system, we can look at the clientName or check if we have any clients

    const clients = await User.find({ role: 'client' });
    const projects = await Project.find({});

    console.log(`Found ${clients.length} clients and ${projects.length} projects`);

    for (const project of projects) {
        if (!project.clientUserId) {
            // Try to find a client with matching name or just pick the first one for seeding consistency
            // The diagnostic showed: Acme Corp (client@acme.com)
            // Project "Mobile App Development" and "OrgConnect" had clientUserId: NULL

            const client = clients.find(c => c.name.toLowerCase().includes(project.clientName.toLowerCase()) ||
                project.clientName.toLowerCase().includes(c.name.toLowerCase()));

            if (client) {
                console.log(`Fixing project "${project.name}" -> linking to client "${client.name}"`);
                project.clientUserId = client._id;
                await project.save();

                await User.findByIdAndUpdate(client._id, {
                    $addToSet: { projectIds: project._id }
                });
            } else {
                console.warn(`Could not find client for project "${project.name}" (Client Name: ${project.clientName})`);
            }
        } else {
            // Ensure the user has the project in their list
            await User.findByIdAndUpdate(project.clientUserId, {
                $addToSet: { projectIds: project._id }
            });
            console.log(`Project "${project.name}" already linked to ${project.clientUserId}. Syncing user array.`);
        }
    }

    console.log('Final Verification:');
    const finalUsers = await User.find({ role: 'client' });
    finalUsers.forEach(u => console.log(`  - ${u.name}: ${u.projectIds.length} projects`));

    console.log('Done.');
    await mongoose.disconnect();
}

fix().catch(console.error);
