import React from "react";
import { Shield } from "lucide-react";
import { usePermissions } from "@/lib/usePermissions";

export default function Invitations() {
  const { canInvite } = usePermissions();

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#D4AF37]" /> Invitations
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Invitez des collaborateurs ou clients.</p>
        </div>
      </div>

      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Maintenance en cours</p>
          <p className="text-sm text-gray-400 mt-1 max-w-sm">
            La gestion des invitations est temporairement indisponible suite à la migration de l'authentification vers le backend.
            Elle sera rétablie dans une prochaine mise à jour.
          </p>
        </div>
      </div>
    </div>
  );
}
