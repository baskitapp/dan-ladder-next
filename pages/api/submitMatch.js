import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    match_id,
    team1,
    team2,
    score_team1,
    score_team2,
    winner_team,
    played_at,
    created_by,
    is_ranked = true
  } = req.body;

  if (!team1 || !team2 || !winner_team) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const allPlayers = [...team1, ...team2];

  const { data: ratingsData, error } = await supabase
    .from('elo_ratings')
    .select('user_id, current_elo, matches_played')
    .in('user_id', allPlayers);

  if (error) return res.status(500).json({ error: error.message });

  const ratingMap = {};
  ratingsData.forEach(r => ratingMap[r.user_id] = r);

  for (const p of allPlayers) {
    if (!ratingMap[p]) {
      await supabase.from('elo_ratings').insert({ user_id: p, current_elo: 1500, matches_played: 0 });
      ratingMap[p] = { current_elo: 1500, matches_played: 0 };
    }
  }

  const avg = team => (ratingMap[team[0]].current_elo + ratingMap[team[1]].current_elo) / 2;
  const e1 = 1 / (1 + Math.pow(10, (avg(team2) - avg(team1)) / 400));
  const e2 = 1 - e1;
  const a1 = winner_team === 'team1' ? 1 : 0;
  const a2 = 1 - a1;
  const K = 32;

  const updatePlayer = async (player, expected, actual) => {
    const oldElo = ratingMap[player].current_elo;
    const newElo = Math.round(oldElo + K * (actual - expected));
    await supabase.from('elo_ratings').upsert({
      user_id: player,
      current_elo: newElo,
      matches_played: ratingMap[player].matches_played + 1
    });
    await supabase.from('elo_history').insert({
      user_id: player,
      match_id,
      elo_before: oldElo,
      elo_after: newElo
    });
  };

  await Promise.all(team1.map(p => updatePlayer(p, e1, a1)));
  await Promise.all(team2.map(p => updatePlayer(p, e2, a2)));

  await supabase.from('matches').insert({
    id: match_id,
    score_team1,
    sc
