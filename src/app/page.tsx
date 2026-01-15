"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { createUser, isUsernameTaken } from "@/lib/firebase/firestore";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import { LiveUserCount } from "@/components/live-user-count";
import { useState } from "react";

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


export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      gender: "male",
      matchPreference: "both"
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!user) {
      console.error("No user signed in.");
      form.setError("username", { type: "manual", message: "You are not signed in. Please refresh the page." });
      return;
    }

    setIsSubmitting(true);

    const usernameExists = await isUsernameTaken(values.username);
    if (usernameExists) {
        form.setError("username", { type: "manual", message: "This username is already taken." });
        setIsSubmitting(false);
        return;
    }
    
    await createUser(user.uid, values.username, {
      gender: values.gender,
      matchPreference: values.matchPreference,
    });

    router.push("/queue");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-8 text-center space-y-8 overflow-hidden">
       <div className="absolute inset-0 -z-10 h-full w-full bg-background bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-20"></div>
       <div className="absolute top-0 left-0 -z-10 h-1/3 w-1/3 bg-accent/20 rounded-full blur-3xl animate-pulse"></div>
       <div className="absolute bottom-0 right-0 -z-10 h-1/3 w-1/3 bg-primary/20 rounded-full blur-3xl animate-pulse animation-delay-4000"></div>
      
      <div className="space-y-4 max-w-2xl">
        <h1 className="text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-accent to-blue-400 md:text-7xl">
          RanChat
        </h1>
        <p className="text-lg text-muted-foreground md:text-xl">
          Instantly connect with new people from around the world through random video chats.
        </p>
      </div>
      
        <div className="w-full max-w-sm p-8 space-y-6 bg-card/60 backdrop-blur-md border border-border rounded-lg shadow-lg">
            <h2 className="text-2xl font-bold text-center">Ready to connect?</h2>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                    <FormItem className="space-y-3 text-left">
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
                    <FormItem className="space-y-3 text-left">
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
                <Button type="submit" disabled={isSubmitting} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground font-bold text-lg px-8 py-6 rounded-full shadow-lg shadow-accent/20 transition-transform transform hover:scale-105">
                  <Rocket className="mr-2 h-5 w-5" />
                  {isSubmitting ? "Starting..." : "Start Chat"}
                </Button>
              </form>
            </Form>
        </div>

      <div className="flex flex-col items-center gap-6 w-full">
        <LiveUserCount />
      </div>

    </main>
  );
}
