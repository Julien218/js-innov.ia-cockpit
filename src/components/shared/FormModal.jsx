import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Compatible avec les pages qui passent:
//   fields={formFields}   → chaque field a .name (ou .key)
//   initialData={editing} → données pré-remplies
//   onSubmit={(data) => save.mutate(data)}
//   loading={save.isPending}
//
// ET l'ancien pattern:
//   data={data} onChange={setData} onSubmit={onSubmit} isSubmitting={loading}

/** @param {any} props */
export default function FormModal({
  open,
  onClose,
  title,
  fields = [],
  initialData,
  onSubmit,
  loading,
  data: controlledData,
  onChange,
  isSubmitting,
}) {
  const [localData, setLocalData] = useState({});

  useEffect(() => {
    if (open) {
      setLocalData(initialData || controlledData || {});
    }
  }, [open, initialData, controlledData]);

  const currentData = controlledData || localData;
  const submitting = isSubmitting ?? loading ?? false;

  const handleChange = (key, value) => {
    const newData = { ...currentData, [key]: value };
    if (onChange) onChange(newData);
    else setLocalData(newData);
  };

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    if (onSubmit) onSubmit(currentData);
    else if (onChange) onChange(currentData);
  };

  const safeFields = Array.isArray(fields) ? fields : [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {safeFields.map((field, idx) => {
            const fieldKey = field.key || field.name || `field_${idx}`;
            return (
              <div key={fieldKey} className="space-y-1.5">
                <Label className="text-xs font-medium">{field.label}</Label>
                {field.type === "select" ? (
                  <Select
                    value={currentData?.[fieldKey] || ""}
                    onValueChange={(v) => handleChange(fieldKey, v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={`Sélectionner ${field.label?.toLowerCase() || ""}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options || []).map((opt) => {
                        const optVal = typeof opt === "string" ? opt : opt.value;
                        const optLabel = typeof opt === "string" ? opt : opt.label;
                        return (
                          <SelectItem key={optVal} value={optVal}>
                            {optLabel}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : field.type === "textarea" ? (
                  <Textarea
                    value={currentData?.[fieldKey] || ""}
                    onChange={(e) => handleChange(fieldKey, e.target.value)}
                    placeholder={field.placeholder || ""}
                    className="h-20"
                  />
                ) : field.type === "checkbox" ? (
                  <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(currentData?.[fieldKey])}
                      onChange={(e) => handleChange(fieldKey, e.target.checked)}
                      className="h-4 w-4"
                    />
                    <span>{currentData?.[fieldKey] ? "Oui" : "Non"}</span>
                  </label>
                ) : (
                  <Input
                    type={field.type || "text"}
                    value={currentData?.[fieldKey] || ""}
                    onChange={(e) =>
                      handleChange(
                        fieldKey,
                        field.type === "number" ? parseFloat(e.target.value) || "" : e.target.value
                      )
                    }
                    placeholder={field.placeholder || ""}
                    required={field.required}
                  />
                )}
              </div>
            );
          })}
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
