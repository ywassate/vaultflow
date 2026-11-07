/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type {
  AuthState,
  LoginCredentials,
  RegisterCredentials,
} from "../types";
import type { AFGHKeyPair } from "../types/afgh";
import { apiService } from "../services/apiService";
import { afghService } from "../services/crypto/afghService";

interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<void>;
  logout: () => Promise<void>;
  updateMasterKey: (password: string) => Promise<void>;
  keyPair: AFGHKeyPair | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
    masterKey: null,
  });

  const [keyPair, setKeyPair] = useState<AFGHKeyPair | null>(null);

  // Check for existing session on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        const token = localStorage.getItem("authToken");
        if (token) {
          const user = await apiService.getCurrentUser();

          // Load AFGH key pair from localStorage
          const storedKeyPair = localStorage.getItem(`afgh_keypair_${user.email}`);
          let afghKeyPair: AFGHKeyPair | null = null;

          if (storedKeyPair) {
            try {
              const parsed = JSON.parse(storedKeyPair);
              afghKeyPair = {
                ...parsed,
                secretKey1: new Uint8Array(Object.values(parsed.secretKey1)),
                secretKey2: new Uint8Array(Object.values(parsed.secretKey2)),
                publicKey1: new Uint8Array(Object.values(parsed.publicKey1)),
                publicKey2: new Uint8Array(Object.values(parsed.publicKey2)),
              };
              console.log("[Auth] AFGH key pair loaded from storage on init");
            } catch (e) {
              console.error("[Auth] Failed to parse stored key pair:", e);
            }
          }

          setKeyPair(afghKeyPair);
          setAuthState((prev) => ({
            ...prev,
            user,
            token,
            isAuthenticated: true,
            isLoading: false,
          }));
        } else {
          setAuthState((prev) => ({ ...prev, isLoading: false }));
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
        localStorage.removeItem("authToken");
        setAuthState((prev) => ({ ...prev, isLoading: false }));
      }
    };

    initAuth();
  }, []);

  const login = async (credentials: LoginCredentials) => {
    try {
      console.log("[Auth] Login started for:", credentials.email);

      // 1. Authenticate with server
      const response = await apiService.login(credentials);
      console.log("[Auth] Server authentication successful");

      // 2. Load AFGH key pair from localStorage
      const storedKeyPair = localStorage.getItem(`afgh_keypair_${credentials.email}`);
      let afghKeyPair: AFGHKeyPair;

      if (storedKeyPair) {
        // Parse stored key pair and restore Uint8Array types
        const parsed = JSON.parse(storedKeyPair);
        afghKeyPair = {
          ...parsed,
          secretKey1: new Uint8Array(Object.values(parsed.secretKey1)),
          secretKey2: new Uint8Array(Object.values(parsed.secretKey2)),
          publicKey1: new Uint8Array(Object.values(parsed.publicKey1)),
          publicKey2: new Uint8Array(Object.values(parsed.publicKey2)),
        };
        console.log("[Auth] AFGH key pair loaded from storage");
      } else {
        // Generate new key pair if not found (first login after migration)
        afghKeyPair = await afghService.generateKeyPair(credentials.email);
        localStorage.setItem(`afgh_keypair_${credentials.email}`, JSON.stringify(afghKeyPair));
        console.log("[Auth] New AFGH key pair generated");
      }

      setAuthState({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
        isLoading: false,
        masterKey: null,
      });

      setKeyPair(afghKeyPair);

      console.log("[Auth] Login complete!");
    } catch (error) {
      console.error("Login error:", error);
      throw error;
    }
  };

  const register = async (credentials: RegisterCredentials) => {
    try {
      console.log("[Auth] Registration started for:", credentials.email);

      // 1. Generate AFGH key pair
      const afghKeyPair = await afghService.generateKeyPair(credentials.email);
      console.log("[Auth] AFGH key pair generated");

      // 2. Store key pair in localStorage
      localStorage.setItem(`afgh_keypair_${credentials.email}`, JSON.stringify(afghKeyPair));
      console.log("[Auth] AFGH key pair stored");

      // 3. Prepare public key for server (base64 encoded)
      const publicKey1B64 = btoa(String.fromCharCode(...afghKeyPair.publicKey1));
      const publicKey2B64 = btoa(String.fromCharCode(...afghKeyPair.publicKey2));

      // 4. Register with server
      const response = await apiService.register({
        ...credentials,
        publicKey: { publicKey1: publicKey1B64, publicKey2: publicKey2B64 },
      });
      console.log("[Auth] Server registration successful");

      setAuthState({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
        isLoading: false,
        masterKey: null,
      });

      setKeyPair(afghKeyPair);

      console.log("[Auth] Registration complete!");
    } catch (error) {
      console.error("Registration error:", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await apiService.logout();
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      // Clear sensitive data
      setAuthState({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        masterKey: null,
      });
      setKeyPair(null);
    }
  };

  const updateMasterKey = async () => {
    // Master key management simplified - AFGH handles key derivation internally
    console.log("[Auth] Master key update requested");
  };

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        register,
        logout,
        updateMasterKey,
        keyPair,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
