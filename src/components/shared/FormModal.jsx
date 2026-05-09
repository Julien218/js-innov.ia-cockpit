import React from "react";
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

export default function FormModal({
  open,
  onClose,
  title,
  fields,
  data,
  onChange,
  onSubmit,
  isSubmitting,
}) {
  const handleChange = (key, value) => {
    onChange({ ...data, [key]: value });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="space-y-4 py-2"
        >
          {fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-xs font-medium">{field.label}</Label>
              {field.type === "select" ? (
                <Select
                  value={data[field.key] || ""}
                  onValueChange={(v) => handleChange(field.key, v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={`Sélectionner ${field.label.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.type === "textarea" ? (
                <Textarea
                  value={data[field.key] || ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="h-20"
                />
              ) : (
                <Input
                  type={field.type || "text"}
                  value={data[field.key] || ""}
                  onChange={(e) =>
                    handleChange(
                      field.key,
                      field.type === "number" ? parseFloat(e.target.value) || "" : e.target.value
                    )
                  }
                  placeholder={field.placeholder}
                  required={field.required}
                />
              )}
            </div>
          ))}
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}