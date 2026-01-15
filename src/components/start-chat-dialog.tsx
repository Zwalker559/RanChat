"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { createUser, updateUserStatus } from "@/lib/firebase/firestore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Rocket } from "lucide-react";
import { Label } from "./ui/label";
import { useEffect, useState } from "react";

const formSchema = z.object({
  username: z.string().min(2, {
    message: "Username must be at least 2 characters.",
  }).max(20, {
    message: "Username must not be longer than 20 characters.",
  }),
  gender: z.enum(["male", "female"], {
    required_error: "You need to select your gender.",
  }),
  matchPreference: z.enum(["male", "female", "both"], {
    required_error: "You need to select a match preference.",
  }),
});

export function StartChatDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const { user, appUser } = useAuth();
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      gender: "male",
      matchPreference: "both"
    },
  });

  useEffect(() => {
    // When the dialog opens and we have existing user data, pre-fill the form
    if (appUser && isOpen) {
        form.reset({
            username: appUser.username || "",
            gender: appUser.preferences.gender,
            matchPreference: appUser.preferences.matchPreference,
        });
    } else if (isOpen) {
        // If it's a new user, reset to defaults just in case
        form.reset({
            username: "",
            gender: "male",
            matchPreference: "both"
        })
    }
  }, [appUser, isOpen, form]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!user) {
      console.error("No user signed in.");
      return;
    }
    
    // Create or update the user document
    await createUser(user.uid, values.username, {
      gender: values.gender,
      matchPreference: values.matchPreference,
    });

    // Set status to searching and navigate to queue
    await updateUserStatus(user.uid, "searching");
    router.push("/queue");
  }
  
  // The DialogTrigger will always open the dialog now.
  // The logic inside onSubmit handles both new and existing users.
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold text-lg px-8 py-6 rounded-full shadow-lg shadow-accent/20 transition-transform transform hover:scale-105">
          <Rocket className="mr-2 h-5 w-5" />
          Start Chat
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{appUser ? "Ready to go?" : "Ready to connect?"}</DialogTitle>
          <DialogDescription>
            {appUser ? "Confirm your details or make changes before starting." : "Just a few things before we find you a match. This is only asked once."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input placeholder="Your cool name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="gender"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Your Gender</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex space-x-4"
                    >
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="male" />
                        </FormControl>
                        <Label className="font-normal">Male</Label>
                      </FormItem>
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="female" />
                        </FormControl>
                        <Label className="font-normal">Female</Label>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="matchPreference"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Match with</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex space-x-4"
                    >
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="male" />
                        </FormControl>
                        <Label className="font-normal">Male</Label>
                      </FormItem>
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="female" />
                        </FormControl>
                        <Label className="font-normal">Female</Label>
                      </FormItem>
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="both" />
                        </FormControl>
                        <Label className="font-normal">Both</Label>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full bg-primary hover:bg-primary/90">{appUser ? "Find a new match" : "Find a match"}</Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
