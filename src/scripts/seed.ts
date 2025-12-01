import pg from 'pg';
import { config } from 'dotenv';
import bcrypt from 'bcrypt';

config();

const { Pool } = pg;

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Seeding database...');

    // Create test users
    const passwordHash = await bcrypt.hash('password123', 12);

    const usersResult = await pool.query(`
      INSERT INTO users (email, name, password_hash, capacity_week_hours)
      VALUES
        ('admin@example.com', 'Admin User', $1, 40),
        ('lead@example.com', 'Team Lead', $1, 40),
        ('dev1@example.com', 'Developer One', $1, 40),
        ('dev2@example.com', 'Developer Two', $1, 32)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, email, name
    `, [passwordHash]);

    if (usersResult.rows.length === 0) {
      console.log('Users already exist, fetching...');
      const existingUsers = await pool.query(`SELECT id, email, name FROM users WHERE email IN ('admin@example.com', 'lead@example.com', 'dev1@example.com', 'dev2@example.com')`);
      usersResult.rows.push(...existingUsers.rows);
    }

    console.log('Created users:', usersResult.rows.map(u => u.email));

    const adminUser = usersResult.rows.find(u => u.email === 'admin@example.com');
    const leadUser = usersResult.rows.find(u => u.email === 'lead@example.com');
    const dev1User = usersResult.rows.find(u => u.email === 'dev1@example.com');
    const dev2User = usersResult.rows.find(u => u.email === 'dev2@example.com');

    if (!adminUser || !leadUser || !dev1User || !dev2User) {
      throw new Error('Failed to create or find users');
    }

    // Create workspace
    const workspaceResult = await pool.query(`
      INSERT INTO workspaces (name, owner_id)
      VALUES ('Demo Workspace', $1)
      ON CONFLICT DO NOTHING
      RETURNING id, name
    `, [adminUser.id]);

    let workspace = workspaceResult.rows[0];
    if (!workspace) {
      const existingWorkspace = await pool.query(`SELECT id, name FROM workspaces WHERE name = 'Demo Workspace'`);
      workspace = existingWorkspace.rows[0];
    }

    console.log('Created workspace:', workspace.name);

    // Add members to workspace
    await pool.query(`
      INSERT INTO user_workspace_roles (workspace_id, user_id, role)
      VALUES
        ($1, $2, 'ADMIN'),
        ($1, $3, 'TEAM_LEAD'),
        ($1, $4, 'DEVELOPER'),
        ($1, $5, 'DEVELOPER')
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `, [workspace.id, adminUser.id, leadUser.id, dev1User.id, dev2User.id]);

    console.log('Added members to workspace');

    // Create sample tasks
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + 1); // Monday of current week

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    const tasks = [
      { title: 'Set up project infrastructure', estimated_hours: 8, assigned: dev1User.id, status: 'DONE', priority: 'HIGH', start_date: formatDate(weekStart) },
      { title: 'Implement user authentication', estimated_hours: 16, assigned: dev1User.id, status: 'IN_PROGRESS', priority: 'HIGH', start_date: formatDate(new Date(weekStart.getTime() + 86400000)) },
      { title: 'Design database schema', estimated_hours: 4, assigned: leadUser.id, status: 'DONE', priority: 'HIGH', start_date: formatDate(weekStart) },
      { title: 'Create API endpoints', estimated_hours: 24, assigned: dev2User.id, status: 'PLANNED', priority: 'MED', start_date: formatDate(new Date(weekStart.getTime() + 86400000 * 2)) },
      { title: 'Build frontend components', estimated_hours: 20, assigned: dev1User.id, status: 'PLANNED', priority: 'MED', start_date: formatDate(new Date(weekStart.getTime() + 86400000 * 3)) },
      { title: 'Write unit tests', estimated_hours: 12, assigned: dev2User.id, status: 'BACKLOG', priority: 'MED', start_date: null },
      { title: 'Code review and refactoring', estimated_hours: 8, assigned: leadUser.id, status: 'BACKLOG', priority: 'LOW', start_date: null },
      { title: 'Documentation', estimated_hours: 6, assigned: null, status: 'BACKLOG', priority: 'LOW', start_date: null },
    ];

    for (const task of tasks) {
      await pool.query(`
        INSERT INTO tasks (workspace_id, title, estimated_hours, assigned_to_user_id, status, priority, start_date, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual')
        ON CONFLICT DO NOTHING
      `, [workspace.id, task.title, task.estimated_hours, task.assigned, task.status, task.priority, task.start_date]);
    }

    console.log('Created sample tasks');

    // Create task dependencies
    const taskResults = await pool.query(`SELECT id, title FROM tasks WHERE workspace_id = $1`, [workspace.id]);
    const taskMap = new Map(taskResults.rows.map(t => [t.title, t.id]));

    const authTask = taskMap.get('Implement user authentication');
    const infraTask = taskMap.get('Set up project infrastructure');
    const apiTask = taskMap.get('Create API endpoints');
    const schemaTask = taskMap.get('Design database schema');

    if (authTask && infraTask) {
      await pool.query(`
        INSERT INTO task_dependencies (task_id, depends_on_task_id, type)
        VALUES ($1, $2, 'FS')
        ON CONFLICT DO NOTHING
      `, [authTask, infraTask]);
    }

    if (apiTask && schemaTask) {
      await pool.query(`
        INSERT INTO task_dependencies (task_id, depends_on_task_id, type)
        VALUES ($1, $2, 'FS')
        ON CONFLICT DO NOTHING
      `, [apiTask, schemaTask]);
    }

    console.log('Created task dependencies');

    console.log('\nSeed completed successfully!');
    console.log('\nTest accounts:');
    console.log('  admin@example.com / password123 (Admin)');
    console.log('  lead@example.com / password123 (Team Lead)');
    console.log('  dev1@example.com / password123 (Developer)');
    console.log('  dev2@example.com / password123 (Developer)');

  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
