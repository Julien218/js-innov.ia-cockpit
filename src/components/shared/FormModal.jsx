import React, { useState, useEffect, useId } from "react";
import { missingRequiredField, numericInput } from '@/lib/formValidation';
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
  // Pattern 1: pages passent initialData + onSubmit
  initialData,
  onSubmit,
  loading,
  // Pattern 2: ancien pattern data + onChange + isSubmitting
  data: controlledData,
  onChange,
  isSubmitting,
}) {
  // State local si pas de controlled data
  const [localData, setLocalData] = useState({});
  const [validationError, setValidationError] = useState('');
  const formId = useId();

  // Réinitialiser quand le modal s'ouvre ou que initialData change
  useEffect(() => {
    if (open) {
      setValidationError('');
      setLocalData(initialData || controlledData || {});
    }
  }, [open, initialData, controlledData]);

  const currentData = controlledData || localData;
  const submitting = isSubmitting ?? loading ?? false;

  const handleChange = (key, value) => {
    const newData = { ...currentData, [key]: value };
    if (onChange) {
      onChange(newData);
    } else {
      setLocalData(newData);
    }
  };

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    if (submitting) return;
    const missing = missingRequiredField(safeFields, currentData);
    if (missing) { setValidationError(`Renseignez le champ « ${missing.label} ».`); return; }
    setValidationError('');
    // Pattern 1: onSubmit reçoit les données directement
    if (onSubmit) {
      onSubmit(currentData);
    }
    // Pattern 2: si pas de onSubmit, propager via onChange
    else if (onChange) {
      onChange(currentData);
    }
  };

  // Supporter field.name ET field.key
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
                <Label htmlFor={`${formId}-${fieldKey}`} className="text-xs font-medium">{field.label}{field.required ? ' *' : ''}</Label>
                {field.type === "select" ? (
                  <Select
                    value={currentData?.[fieldKey] || ""}
                    onValueChange={(v) => handleChange(fieldKey, v)}
                  >
                    <SelectTrigger id={`${formId}-${fieldKey}`} aria-required={field.required}>
                      <SelectValue placeholder={`Sélectionner ${field.label?.toLowerCase() || ""}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options || []).map((opt) => {
                        // Supporter ["val1","val2"] et [{value, label}]
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
                    id={`${formId}-${fieldKey}`}
                    required={field.required}
                    value={currentData?.[fieldKey] || ""}
                    onChange={(e) => handleChange(fieldKey, e.target.value)}
                    placeholder={field.placeholder || ""}
                    className="h-20"
                  />
                ) : (
                  <Input
                    id={`${formId}-${fieldKey}`}
                    type={field.type || "text"}
                    value={currentData?.[fieldKey] ?? ""}
                    onChange={(e) =>
                      handleChange(
                        fieldKey,
                        field.type === "number" ? numericInput(e.target.value) : e.target.value
                      )
                    }
                    placeholder={field.placeholder || ""}
                    required={field.required}
                  />
                )}
              </div>
            );
          })}
          {validationError && <p role="alert" className="text-sm text-red-400">{validationError}</p>}
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
