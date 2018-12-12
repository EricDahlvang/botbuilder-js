/**
 * @module botbuilder-memory
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { TurnContext } from 'botbuilder-core';
import { DocumentAccessor } from './documentAccessor';
import { PropertyAccessor } from './propertyAccessor';
import { PropertyBase } from './propertyBase';
import { PropertyEvent } from './propertyEventSource';

export class Document<T = any> extends PropertyBase<T> implements DocumentAccessor {
    private readonly properties: PropertyAccessor[] = [];

    public addProperty(property: PropertyAccessor): this {
        property.parent = this;
        this.properties.push(property);
        return this;
    }

    public forEachProperty(callbackfn: (property: PropertyAccessor, index: number, array: PropertyAccessor[]) => void): void {
        this.properties.forEach(callbackfn);
    }

    public async deleteProperty(context: TurnContext, id: string): Promise<void> {
        const docId = await this.getId(context);
        const container = await this.parent.getProperty(context, docId, {});
        if (container.hasOwnProperty(id)) {
            delete container[id];
            await this.parent.setProperty(context, docId, container);
        }
    }
    
    public async getProperty<T = any>(context: TurnContext, id: string): Promise<T | undefined>;
    public async getProperty<T = any>(context: TurnContext, id: string, defaultValue: T): Promise<T>;
    public async getProperty<T = any>(context: TurnContext, id: string, defaultValue?: T): Promise<T> {
        const docId = await this.getId(context);
        const container = await this.parent.getProperty(context, docId, {});
        if (!container.hasOwnProperty(id) && defaultValue !== undefined) {
            container[id] = defaultValue;
            await this.parent.setProperty(context, docId, container);
        }

        return container[id];
    }

    public async setProperty(context: TurnContext, id: string, value: any): Promise<void> {
        const docId = await this.getId(context);
        const container = await this.parent.getProperty(context, docId, {});
        container[id] = value;
        await this.parent.setProperty(context, docId, container);
    }

    public async emitEvent(context: TurnContext, event: PropertyEvent, next: () => Promise<void>): Promise<void> {
        // We want to bubble event to our parent after they've been dispatched locally. 
        await super.emitEvent(context, event, async () => {
            await this.parent.emitEvent(context, event, async () => {
                await next();
            });
        });
    }

    protected async onHasChanged(context: TurnContext, value: T): Promise<boolean> {
        const docId = await this.getId(context);
        const hasValue = await this.parent.getProperty(context, docId) !== undefined;
        if (typeof value === 'object') {
            if (hasValue) {
                // Check for any changes to individual properties
                for (let i = 0; i < this.properties.length; i++) {
                    const prop = this.properties[i];
                    const id = await prop.getId(context);

                    // Treat value as a partial so only check properties that have been set
                    if (value.hasOwnProperty(id)) {
                        const changed = await prop.hasChanged(context, value[id]);
                        if (changed) {
                            return true;
                        }
                    }
                }
            } else {
                // We don't have anything assigned so return true
                return true;
            }
        } else {
            // We're being deleted so just return hasValue
            return hasValue;
        }
    }

    protected async onGet(context: TurnContext, defaultValue?: T): Promise<T | undefined> {
        const docId = await this.getId(context);
        const hasValue = await this.parent.getProperty(context, docId) !== undefined;
        if (hasValue || defaultValue !== undefined) {
            // Enumerate properties to assemble return value
            const value: T = {} as T;
            if (defaultValue === undefined) { defaultValue = {} as T }
            for (let i = 0; i < this.properties.length; i++) {
                const prop = this.properties[i];
                const id = await prop.getId(context);
                value[id] = await prop.get(context, defaultValue[id]);
            }
            return value;
        }

        return undefined;
    }

    protected async onSet(context: TurnContext, value: T): Promise<void> {
        // Enumerate properties and set individual value members 
        if (typeof value !== 'object') { value = {} as T }
        for (let i = 0; i < this.properties.length; i++) {
            const prop = this.properties[i];
            const id = await prop.getId(context);

            // Treat value as a partial so ignore any missing properties
            if (value.hasOwnProperty(id)) {
                await prop.set(context, value[id]);
            }
        }
    }
}