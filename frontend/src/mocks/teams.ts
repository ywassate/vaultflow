/**
 * Teams Data Service
 * Uses real backend API for team operations
 */
import type { Team, TeamMember } from "../types/teams";

// Local cache for reactive UI updates
let teamsCache: Team[] = [];
let cacheInitialized = false;

// API base URL
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// Get auth token
const getAuthHeaders = () => {
  const token = localStorage.getItem('authToken');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

// Initialize cache from API
const initCache = async (): Promise<void> => {
  if (!cacheInitialized) {
    try {
      const response = await fetch(`${API_URL}/teams`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        teamsCache = await response.json();
        cacheInitialized = true;
      }
    } catch {
      console.warn('[Teams] API not available, using empty cache');
      teamsCache = [];
    }
  }
};

// Refresh cache from API
export const refreshTeamsCache = async (): Promise<Team[]> => {
  try {
    const response = await fetch(`${API_URL}/teams`, {
      headers: getAuthHeaders()
    });
    if (response.ok) {
      teamsCache = await response.json();
      cacheInitialized = true;
    }
    return teamsCache;
  } catch (error) {
    console.error('[Teams] Failed to refresh cache:', error);
    return teamsCache;
  }
};

// Helper functions
export const getTeamById = (id: string): Team | undefined => {
  return teamsCache.find((team) => team.id === id);
};

export const getTeamByIdAsync = async (id: string): Promise<Team | undefined> => {
  try {
    const response = await fetch(`${API_URL}/teams/${id}`, {
      headers: getAuthHeaders()
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error('[Teams] Failed to get team:', error);
  }
  return getTeamById(id);
};

export const getAllTeams = (): Team[] => {
  if (!cacheInitialized) {
    initCache();
  }
  return teamsCache;
};

export const getAllTeamsAsync = async (): Promise<Team[]> => {
  return refreshTeamsCache();
};

export const getTeamMembers = (teamId: string): TeamMember[] => {
  const team = teamsCache.find(t => t.id === teamId);
  return team?.members || [];
};

export const addTeam = (team: Team): void => {
  // Optimistic update
  teamsCache.push(team);

  // Call API
  fetch(`${API_URL}/teams`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      name: team.name,
      description: team.description
    })
  }).then(response => {
    if (response.ok) {
      return response.json();
    }
    throw new Error('Failed to create team');
  }).then(created => {
    // Update cache with server-generated data
    const index = teamsCache.findIndex(t => t.id === team.id);
    if (index > -1) {
      teamsCache[index] = created;
    }
  }).catch(error => {
    console.error('[Teams] Failed to create team:', error);
    // Rollback
    const index = teamsCache.findIndex(t => t.id === team.id);
    if (index > -1) {
      teamsCache.splice(index, 1);
    }
  });
};

export const addTeamAsync = async (team: Partial<Team>): Promise<Team> => {
  const response = await fetch(`${API_URL}/teams`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      name: team.name,
      description: team.description
    })
  });

  if (!response.ok) {
    throw new Error('Failed to create team');
  }

  const created = await response.json();
  teamsCache.push(created);
  return created;
};

export const deleteTeamById = (id: string): Team[] => {
  // Optimistic update
  const index = teamsCache.findIndex((team) => team.id === id);
  const deleted = index > -1 ? teamsCache.splice(index, 1)[0] : null;

  // Call API
  fetch(`${API_URL}/teams/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  }).catch(error => {
    console.error('[Teams] Failed to delete team:', error);
    // Rollback
    if (deleted) {
      teamsCache.push(deleted);
    }
  });

  return teamsCache;
};

export const deleteTeamByIdAsync = async (id: string): Promise<void> => {
  const response = await fetch(`${API_URL}/teams/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });

  if (!response.ok) {
    throw new Error('Failed to delete team');
  }

  const index = teamsCache.findIndex((team) => team.id === id);
  if (index > -1) {
    teamsCache.splice(index, 1);
  }
};

export const addTeamMember = (teamId: string, member: TeamMember): void => {
  // Update local cache
  const team = teamsCache.find(t => t.id === teamId);
  if (team) {
    if (!team.members) team.members = [];
    team.members.push(member);
    team.memberCount = team.members.length;
  }

  // Call API
  fetch(`${API_URL}/teams/${teamId}/members`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      email: member.email,
      role: member.role
    })
  }).catch(error => {
    console.error('[Teams] Failed to add member:', error);
    // Rollback
    if (team && team.members) {
      const idx = team.members.findIndex(m => m.id === member.id);
      if (idx > -1) team.members.splice(idx, 1);
      team.memberCount = team.members.length;
    }
  });
};

export const removeTeamMember = (teamId: string, memberId: string): void => {
  // Update local cache
  const team = teamsCache.find(t => t.id === teamId);
  let removed: TeamMember | undefined;
  if (team && team.members) {
    const idx = team.members.findIndex(m => m.id === memberId);
    if (idx > -1) {
      removed = team.members.splice(idx, 1)[0];
      team.memberCount = team.members.length;
    }
  }

  // Call API
  fetch(`${API_URL}/teams/${teamId}/members/${memberId}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  }).catch(error => {
    console.error('[Teams] Failed to remove member:', error);
    // Rollback
    if (team && removed) {
      team.members?.push(removed);
      team.memberCount = team.members?.length || 0;
    }
  });
};

export const updateTeamMemberRole = (
  teamId: string,
  memberId: string,
  newRole: "admin" | "member" | "viewer"
): void => {
  const team = teamsCache.find(t => t.id === teamId);
  if (team && team.members) {
    const member = team.members.find((m) => m.id === memberId);
    if (member) {
      member.role = newRole;
    }
  }
  // TODO: Add API endpoint for role update
};

export const updateTeam = (
  teamId: string,
  updatedTeam: Partial<Team>
): Team | undefined => {
  const index = teamsCache.findIndex((team) => team.id === teamId);
  if (index > -1) {
    teamsCache[index] = { ...teamsCache[index], ...updatedTeam };

    // Call API
    fetch(`${API_URL}/teams/${teamId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: updatedTeam.name,
        description: updatedTeam.description
      })
    }).catch(error => {
      console.error('[Teams] Failed to update team:', error);
    });

    return teamsCache[index];
  }
  return undefined;
};

// Get user info by email
export const getUserByEmail = (email: string): { name: string; email: string; avatar?: string } | undefined => {
  // Search in all team members
  for (const team of teamsCache) {
    if (team.members) {
      const member = team.members.find((m) => m.email === email);
      if (member) {
        return {
          name: member.name,
          email: member.email,
          avatar: member.avatar,
        };
      }
    }
  }

  // Check current user
  try {
    const userStr = localStorage.getItem('currentUser');
    if (userStr) {
      const user = JSON.parse(userStr);
      if (user.email === email) {
        return {
          name: user.name,
          email: user.email,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`
        };
      }
    }
  } catch {
    // Ignore
  }

  return undefined;
};

// Initialize cache on module load
initCache();
