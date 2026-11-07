export type UserRole = "admin" | "member" | "viewer";

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  joinedAt?: string;
  avatar?: string;
}

export interface Team {
  memberCount: number;
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
  members: TeamMember[];
  sharedFiles: number;
  settings: Partial<TeamSettings>;
}

export interface TeamSettings {
  allowMemberInvites: boolean;
  allowFileSharing: boolean;
  requireApproval: boolean;
  maxMembers: number;
}

export interface TeamInvitation {
  id: string;
  teamId: string;
  teamName: string;
  invitedBy: string;
  invitedEmail: string;
  role: UserRole;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  expiresAt: string;
}

export const ROLE_PERMISSIONS = {
  admin: {
    canManageMembers: true,
    canManageSettings: true,
    canShareFiles: true,
    canUploadFiles: true,
    canDownloadFiles: true,
    canDeleteFiles: true,
    canInviteMembers: true,
  },
  member: {
    canManageMembers: false,
    canManageSettings: false,
    canShareFiles: true,
    canUploadFiles: true,
    canDownloadFiles: true,
    canDeleteFiles: true,
    canInviteMembers: false,
  },
  viewer: {
    canManageMembers: false,
    canManageSettings: false,
    canShareFiles: false,
    canUploadFiles: false,
    canDownloadFiles: true,
    canDeleteFiles: false,
    canInviteMembers: false,
  },
};
