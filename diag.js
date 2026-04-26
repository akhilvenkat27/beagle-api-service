require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Project = require('./models/Project');
const Task = require('./models/Task');

async function diagnostic() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/beagle-udip');

    console.log('--- TEST 1: Clients Count ---');
    const clients = await User.find({ role: 'client' });
    console.log(`Found ${clients.length} clients`);
    clients.forEach(c => console.log(`  - ${c.name} (${c.email}) [projectIds: ${c.projectIds?.length || 0}]`));

    console.log('\n--- TEST 2: Projects with clientUserId ---');
    const projects = await Project.find({});
    console.log(`Found ${projects.length} total projects`);
    projects.forEach(p => console.log(`  - ${p.name} [clientUserId: ${p.clientUserId || 'NULL'}]`));

    console.log('\n--- TEST 3: Tasks with assignedTo ---');
    const tasks = await Task.find({}).populate('assignedTo', 'name');
    console.log(`Found ${tasks.length} total tasks`);
    tasks.filter(t => t.assignedTo).forEach(t => console.log(`  - ${t.title} [assignedTo: ${t.assignedTo?.name || 'UNKNOWN'}]`));

    await mongoose.disconnect();
}

diagnostic().catch(console.error);
