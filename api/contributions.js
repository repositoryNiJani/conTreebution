// Vercel / Netlify-style serverless function: GET /api/contributions?user=NAME&range=year|all
// Needs one environment variable: GITHUB_TOKEN (a personal access token; no scopes needed for public data).
// The token stays on the server. Never put it in index.html.

const USER_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

async function gql(token, query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'contribution-tree'
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`GitHub responded with ${res.status}`);
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const user = String((req.query && req.query.user) || '').trim();
  const range = req.query && req.query.range === 'all' ? 'all' : 'year';

  if (!USER_RE.test(user)) {
    return res.status(400).json({ error: 'Invalid GitHub username.' });
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'GITHUB_TOKEN is not set on the server.' });
  }

  try {
    // Last 12 months plus the account creation date, in one request.
    const first = await gql(
      token,
      `query($login: String!) {
         user(login: $login) {
           createdAt
             contributionsCollection {
               contributionCalendar {
                 totalContributions
                 weeks {
                   contributionDays { date contributionCount contributionLevel }
                 }
               }
             }
           }
       }`,
      { login: user }
    );

    if (!first.data || !first.data.user) {
      return res.status(404).json({ error: `GitHub user "${user}" was not found.` });
    }

    const calendar = first.data.user.contributionsCollection.contributionCalendar;
    const days = calendar.weeks.flatMap((week) => week.contributionDays.map((day) => ({
      date: day.date,
      count: day.contributionCount,
      level: ({
        NONE: 0,
        FIRST_QUARTILE: 1,
        SECOND_QUARTILE: 2,
        THIRD_QUARTILE: 3,
        FOURTH_QUARTILE: 4
      })[day.contributionLevel] || 0
    })));
    let total = calendar.totalContributions;

    if (range === 'all') {
      // contributionsCollection covers at most one year per call, so ask for each year with aliases.
      const startYear = new Date(first.data.user.createdAt).getUTCFullYear();
      const now = new Date();
      const parts = [];
      for (let y = startYear; y <= now.getUTCFullYear(); y++) {
        const from = new Date(Date.UTC(y, 0, 1));
        const to = new Date(Math.min(Date.UTC(y, 11, 31, 23, 59, 59), now.getTime()));
        parts.push(
          `y${y}: contributionsCollection(from: "${from.toISOString()}", to: "${to.toISOString()}") {
             contributionCalendar { totalContributions }
           }`
        );
      }
      const all = await gql(token, `query($login: String!) { user(login: $login) { ${parts.join('\n')} } }`, { login: user });
      if (!all.data || !all.data.user) throw new Error('Could not read yearly contributions.');
      total = Object.values(all.data.user).reduce((sum, c) => sum + c.contributionCalendar.totalContributions, 0);
    }

    // Cache at the CDN so a portfolio embed does not hit GitHub on every page view.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ user, range, total, calendar: days });
  } catch (err) {
    return res.status(502).json({ error: 'Could not load data from GitHub.' });
  }
};